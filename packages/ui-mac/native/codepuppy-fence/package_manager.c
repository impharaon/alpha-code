#define NAPI_VERSION 8
#include <node_api.h>
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <servers/bootstrap.h>
#include <pthread.h>
#include <stdatomic.h>
#include <limits.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "package_manager_ipc.h"

typedef struct pm_request {
  atomic_int references;
  pthread_mutex_t lock;
  pthread_cond_t condition;
  int answered;
  pm_claim_message claim;
  pm_grant_message grant;
  audit_token_t peer;
  char executable[PROC_PIDPATHINFO_MAXSIZE];
  char identity[256];
} pm_request;
typedef struct pm_service {
  atomic_int running;
  pthread_t thread;
  pthread_mutex_t lock;
  pm_request *current;
  mach_port_t port;
  name_t name;
  char helper[PATH_MAX];
  CFDataRef code_hash;
  CFStringRef identifier;
  napi_threadsafe_function callback;
  struct pm_service *next;
} pm_service;
static pm_service *services;

static napi_value fail(napi_env env, const char *message) { napi_throw_error(env,NULL,message); return NULL; }
static void release_request(pm_request *request) {
  if (atomic_fetch_sub(&request->references,1)!=1) return;
  pm_clear(request->claim.proof,sizeof request->claim.proof);
  pm_clear(request->grant.authorization,sizeof request->grant.authorization);
  pthread_mutex_destroy(&request->lock); pthread_cond_destroy(&request->condition); free(request);
}
static int copy_string(napi_env env,napi_value value,char *buffer,size_t size) {
  size_t length=0, copied=0;
  return napi_get_value_string_utf8(env,value,NULL,0,&length)==napi_ok && length<size &&
    napi_get_value_string_utf8(env,value,buffer,size,&copied)==napi_ok && copied==length && !memchr(buffer,0,length);
}
static int process_audit(pid_t pid,audit_token_t *audit) {
  mach_port_t task=MACH_PORT_NULL;
  if(task_name_for_pid(mach_task_self(),pid,&task)!=KERN_SUCCESS) return 0;
  mach_msg_type_number_t count=TASK_AUDIT_TOKEN_COUNT;
  kern_return_t result=task_info(task,TASK_AUDIT_TOKEN,(task_info_t)audit,&count);
  mach_port_deallocate(mach_task_self(),task); return result==KERN_SUCCESS;
}
static CFDictionaryRef signing_info(SecStaticCodeRef code) {
  CFDictionaryRef info=NULL;
  if(SecCodeCopySigningInformation(code,kSecCSSigningInformation,&info)!=errSecSuccess) return NULL;
  return info;
}
static int strict_helper(CFDictionaryRef info) {
  if(!info) return 0;
  CFNumberRef flags=CFDictionaryGetValue(info,kSecCodeInfoFlags); uint32_t value=0;
  if(!flags || !CFNumberGetValue(flags,kCFNumberSInt32Type,&value) || (value&0x10000)==0) return 0;
  CFDictionaryRef entitlements=CFDictionaryGetValue(info,kSecCodeInfoEntitlementsDict);
  return !entitlements || (CFGetTypeID(entitlements)==CFDictionaryGetTypeID() && CFDictionaryGetCount(entitlements)==0);
}
static int peer_is_helper(pm_service *service,pm_request *request) {
  if(proc_pidpath(request->peer.val[5],request->executable,sizeof request->executable)<=0 || strcmp(request->executable,service->helper)) return 0;
  CFDataRef audit=CFDataCreate(NULL,(const UInt8*)&request->peer,sizeof request->peer);
  const void *keys[]={kSecGuestAttributeAudit}, *values[]={audit};
  CFDictionaryRef attributes=CFDictionaryCreate(NULL,keys,values,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
  SecCodeRef guest=NULL;
  OSStatus status=SecCodeCopyGuestWithAttributes(NULL,attributes,kSecCSDefaultFlags,&guest);
  CFRelease(attributes); CFRelease(audit);
  if(status!=errSecSuccess) return 0;
  int valid=SecCodeCheckValidity(guest,kSecCSStrictValidate,NULL)==errSecSuccess;
  CFDictionaryRef info=signing_info((SecStaticCodeRef)guest);
  if(!info) { CFRelease(guest); return 0; }
  CFDataRef hash=CFDictionaryGetValue(info,kSecCodeInfoUnique);
  CFStringRef identifier=CFDictionaryGetValue(info,kSecCodeInfoIdentifier);
  valid=valid && strict_helper(info) && hash && identifier && CFEqual(hash,service->code_hash) && CFEqual(identifier,service->identifier) && CFStringGetCString(identifier,request->identity,sizeof request->identity,kCFStringEncodingUTF8);
  CFRelease(info); CFRelease(guest); return valid;
}
static void request_function_finalizer(napi_env env,void *data,void *hint) { (void)env;(void)hint; release_request(data); }
static napi_value respond(napi_env env,napi_callback_info info) {
  size_t argc=1; napi_value argv[1],value; void *data=NULL;
  napi_get_cb_info(env,info,&argc,argv,NULL,&data);
  pm_request *request=data; pm_grant_message grant={0}; grant.kind=PM_UNAUTHORIZED;
  char kind[32]={0};
  if(argc==1 && napi_get_named_property(env,argv[0],"kind",&value)==napi_ok && copy_string(env,value,kind,sizeof kind)) {
    if(!strcmp(kind,"delegated")) {
      napi_value port,authorization; uint32_t number=0;
      if(napi_get_named_property(env,argv[0],"brokerPort",&port)==napi_ok && napi_get_value_uint32(env,port,&number)==napi_ok && number>0 && number<=65535 &&
        napi_get_named_property(env,argv[0],"authorization",&authorization)==napi_ok && copy_string(env,authorization,grant.authorization,sizeof grant.authorization) && strlen(grant.authorization)==64) { grant.kind=PM_DELEGATED; grant.port=number; }
    } else if(!strcmp(kind,"fenced")) grant.kind=PM_FENCED;
    else if(!strcmp(kind,"error")) {
      char error[32]={0};
      if(napi_get_named_property(env,argv[0],"error",&value)==napi_ok && copy_string(env,value,error,sizeof error)) {
        if(!strcmp(error,"inactive-execution")) grant.kind=PM_INACTIVE;
        if(!strcmp(error,"node-consumed")) grant.kind=PM_CONSUMED;
      }
    }
  }
  pthread_mutex_lock(&request->lock);
  if(!request->answered) { request->grant=grant; request->answered=1; pthread_cond_signal(&request->condition); }
  pthread_mutex_unlock(&request->lock);
  pm_clear(grant.authorization,sizeof grant.authorization);
  napi_get_undefined(env,&value); return value;
}
static void set_text(napi_env env,napi_value object,const char *name,const char *text) { napi_value value; napi_create_string_utf8(env,text,NAPI_AUTO_LENGTH,&value); napi_set_named_property(env,object,name,value); }
static void set_number(napi_env env,napi_value object,const char *name,uint32_t number) { napi_value value; napi_create_uint32(env,number,&value); napi_set_named_property(env,object,name,value); }
static void dispatch(napi_env env,napi_value callback,void *context,void *data) {
  (void)context; pm_request *request=data;
  if(!env) { release_request(request); return; }
  napi_value input,peer,reply,receiver,result,args[3];
  napi_create_object(env,&input); set_text(env,input,"executionID",request->claim.execution); set_text(env,input,"nodeID",request->claim.node); set_text(env,input,"nodeProof",request->claim.proof);
  napi_create_object(env,&peer); set_number(env,peer,"pid",request->peer.val[5]); set_number(env,peer,"pidversion",request->peer.val[7]); set_text(env,peer,"executable",request->executable); set_text(env,peer,"signingIdentity",request->identity);
  napi_create_function(env,"reply",NAPI_AUTO_LENGTH,respond,request,&reply);
  napi_add_finalizer(env,reply,request,request_function_finalizer,NULL,NULL);
  args[0]=input; args[1]=peer; args[2]=reply; napi_get_undefined(env,&receiver);
  if(napi_call_function(env,receiver,callback,3,args,&result)!=napi_ok) {
    bool pending=false; napi_is_exception_pending(env,&pending); if(pending) napi_get_and_clear_last_exception(env,&result);
    pthread_mutex_lock(&request->lock); if(!request->answered) { request->grant.kind=PM_UNAUTHORIZED; request->answered=1; pthread_cond_signal(&request->condition); } pthread_mutex_unlock(&request->lock);
  }
}
static void send_reply(pm_request *request) {
  request->grant.header.msgh_bits=MACH_MSGH_BITS(MACH_MSG_TYPE_MOVE_SEND_ONCE,0);
  request->grant.header.msgh_size=sizeof request->grant;
  request->grant.header.msgh_remote_port=request->claim.header.msgh_remote_port;
  mach_msg(&request->grant.header,MACH_SEND_MSG|MACH_SEND_TIMEOUT,sizeof request->grant,0,MACH_PORT_NULL,0,MACH_PORT_NULL);
}
static void *receive_claims(void *data) {
  pm_service *service=data;
  while(atomic_load(&service->running)) {
    struct { pm_claim_message claim; mach_msg_audit_trailer_t trailer; } message={0};
    mach_msg_option_t options=MACH_RCV_MSG|MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0)|MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT);
    kern_return_t status=mach_msg(&message.claim.header,options,0,sizeof message,service->port,0,MACH_PORT_NULL);
    if(status!=KERN_SUCCESS) { if(!atomic_load(&service->running)) break; continue; }
    if(message.claim.header.msgh_size!=sizeof(pm_claim_message) || message.claim.header.msgh_bits&MACH_MSGH_BITS_COMPLEX) { mach_msg_destroy(&message.claim.header); continue; }
    mach_msg_audit_trailer_t *trailer=(void*)((char*)&message+((message.claim.header.msgh_size+3)&~3));
    pm_request *request=calloc(1,sizeof *request); if(!request) { mach_msg_destroy(&message.claim.header); continue; }
    atomic_init(&request->references,1); pthread_mutex_init(&request->lock,NULL); pthread_cond_init(&request->condition,NULL);
    request->claim=message.claim; request->peer=trailer->msgh_audit; request->grant.kind=PM_UNAUTHORIZED;
    int valid=trailer->msgh_trailer_size>=sizeof *trailer && memchr(request->claim.execution,0,sizeof request->claim.execution) && memchr(request->claim.node,0,sizeof request->claim.node) && memchr(request->claim.proof,0,sizeof request->claim.proof) && peer_is_helper(service,request);
    if(valid) {
      pthread_mutex_lock(&service->lock); service->current=request;
      if(!atomic_load(&service->running)) { request->answered=1; request->grant.kind=PM_INACTIVE; }
      pthread_mutex_unlock(&service->lock);
      atomic_fetch_add(&request->references,1);
      if(napi_call_threadsafe_function(service->callback,request,napi_tsfn_nonblocking)!=napi_ok) { release_request(request); pthread_mutex_lock(&request->lock); request->answered=1; pthread_mutex_unlock(&request->lock); }
      pthread_mutex_lock(&request->lock); while(!request->answered) pthread_cond_wait(&request->condition,&request->lock); pthread_mutex_unlock(&request->lock);
      pthread_mutex_lock(&service->lock); service->current=NULL; pthread_mutex_unlock(&service->lock);
    }
    send_reply(request); release_request(request);
  }
  napi_release_threadsafe_function(service->callback,napi_tsfn_release); return NULL;
}
static void stop_service(pm_service *service) {
  if(!atomic_exchange(&service->running,0)) return;
  pthread_mutex_lock(&service->lock);
  if(service->current) { pthread_mutex_lock(&service->current->lock); if(!service->current->answered) { service->current->grant.kind=PM_INACTIVE; service->current->answered=1; pthread_cond_signal(&service->current->condition); } pthread_mutex_unlock(&service->current->lock); }
  pthread_mutex_unlock(&service->lock);
  bootstrap_register(bootstrap_port,service->name,MACH_PORT_NULL);
  mach_port_mod_refs(mach_task_self(),service->port,MACH_PORT_RIGHT_RECEIVE,-1);
  pthread_join(service->thread,NULL);
  mach_port_deallocate(mach_task_self(),service->port);
}
static void cleanup_service(void *data) { stop_service(data); }
static void service_finalizer(napi_env env,void *data,void *hint) {
  (void)hint; pm_service *service=data; napi_remove_env_cleanup_hook(env,cleanup_service,service); stop_service(service);
  pm_service **entry=&services; while(*entry && *entry!=service) entry=&(*entry)->next; if(*entry) *entry=service->next;
  CFRelease(service->code_hash); CFRelease(service->identifier); pthread_mutex_destroy(&service->lock); free(service);
}
static napi_value start_service(napi_env env,napi_callback_info info) {
  size_t argc=3; napi_value argv[3],name,external;
  napi_get_cb_info(env,info,&argc,argv,NULL,NULL);
  char path[PATH_MAX],service_name[sizeof(name_t)];
  if(argc!=3 || !copy_string(env,argv[0],service_name,sizeof service_name) || !copy_string(env,argv[1],path,sizeof path)) return fail(env,"package-manager service requires name, helper and callback");
  napi_valuetype type; napi_typeof(env,argv[2],&type); if(type!=napi_function) return fail(env,"package-manager claim callback missing");
  char canonical[PATH_MAX]; if(!realpath(path,canonical)) return fail(env,"package-manager helper is unavailable");
  CFURLRef url=CFURLCreateFromFileSystemRepresentation(NULL,(const UInt8*)canonical,strlen(canonical),false);
  SecStaticCodeRef helper=NULL;
  OSStatus status=SecStaticCodeCreateWithPath(url,kSecCSDefaultFlags,&helper); CFRelease(url);
  if(status!=errSecSuccess || SecStaticCodeCheckValidity(helper,kSecCSStrictValidate|kSecCSCheckAllArchitectures,NULL)!=errSecSuccess) { if(helper) CFRelease(helper); return fail(env,"package-manager helper signature invalid"); }
  CFDictionaryRef attributes=signing_info(helper); CFRelease(helper);
  SecCodeRef self=NULL; SecCodeCopySelf(kSecCSDefaultFlags,&self); CFDictionaryRef own=self?signing_info((SecStaticCodeRef)self):NULL;
  CFStringRef team=attributes?CFDictionaryGetValue(attributes,kSecCodeInfoTeamIdentifier):NULL, own_team=own?CFDictionaryGetValue(own,kSecCodeInfoTeamIdentifier):NULL;
  CFDataRef hash=attributes?CFDictionaryGetValue(attributes,kSecCodeInfoUnique):NULL; CFStringRef identifier=attributes?CFDictionaryGetValue(attributes,kSecCodeInfoIdentifier):NULL;
  int valid=strict_helper(attributes) && hash && identifier && (!own_team || (team && CFEqual(team,own_team)));
  if(own) CFRelease(own); if(self) CFRelease(self);
  if(!valid) { if(attributes) CFRelease(attributes); return fail(env,"package-manager helper must have strict hardened code and the application signing team"); }
  pm_service *service=calloc(1,sizeof *service); if(!service) { CFRelease(attributes); return fail(env,"package-manager service allocation failed"); }
  service->code_hash=CFRetain(hash); service->identifier=CFRetain(identifier); CFRelease(attributes);
  strlcpy(service->helper,canonical,sizeof service->helper); strlcpy(service->name,service_name,sizeof service->name); pthread_mutex_init(&service->lock,NULL);
  status=mach_port_allocate(mach_task_self(),MACH_PORT_RIGHT_RECEIVE,&service->port);
  if(status==KERN_SUCCESS) status=mach_port_insert_right(mach_task_self(),service->port,service->port,MACH_MSG_TYPE_MAKE_SEND);
  if(status==KERN_SUCCESS) status=bootstrap_register(bootstrap_port,service->name,service->port);
  if(status!=KERN_SUCCESS) { CFRelease(service->code_hash); CFRelease(service->identifier); pthread_mutex_destroy(&service->lock); free(service); return fail(env,"package-manager Mach service registration failed"); }
  napi_create_string_utf8(env,"package-manager claim",NAPI_AUTO_LENGTH,&name);
  napi_status created=napi_create_threadsafe_function(env,argv[2],NULL,name,0,1,NULL,NULL,NULL,dispatch,&service->callback);
  if(created!=napi_ok) { mach_port_mod_refs(mach_task_self(),service->port,MACH_PORT_RIGHT_RECEIVE,-1); mach_port_deallocate(mach_task_self(),service->port); CFRelease(service->code_hash); CFRelease(service->identifier); free(service); return fail(env,"package-manager claim callback registration failed"); }
  napi_unref_threadsafe_function(env,service->callback); atomic_init(&service->running,1);
  if(pthread_create(&service->thread,NULL,receive_claims,service)!=0) { atomic_store(&service->running,0); napi_release_threadsafe_function(service->callback,napi_tsfn_abort); mach_port_mod_refs(mach_task_self(),service->port,MACH_PORT_RIGHT_RECEIVE,-1); mach_port_deallocate(mach_task_self(),service->port); CFRelease(service->code_hash); CFRelease(service->identifier); free(service); return fail(env,"package-manager receive thread failed"); }
  service->next=services; services=service;
  napi_create_external(env,service,service_finalizer,NULL,&external);
  napi_add_env_cleanup_hook(env,cleanup_service,service); return external;
}
static napi_value close_service(napi_env env,napi_callback_info info) {
  size_t argc=1; napi_value argv[1],result; void *data=NULL;
  napi_get_cb_info(env,info,&argc,argv,NULL,NULL);
  if(argc!=1 || napi_get_value_external(env,argv[0],&data)!=napi_ok) return fail(env,"package-manager service handle required");
  stop_service(data); napi_get_undefined(env,&result); return result;
}
static int pid_argument(napi_env env,napi_value value,pid_t *pid) {
  double number=0;
  if(napi_get_value_double(env,value,&number)!=napi_ok || !isfinite(number) || number<1 || number>INT_MAX || floor(number)!=number) return 0;
  *pid=(pid_t)number; return 1;
}
// Monotonic kernel birth of a process instance: written at creation, unchanged by exec or calendar changes.
static int process_start(pid_t pid,uint64_t *start) {
  struct rusage_info_v4 usage;
  if(proc_pid_rusage(pid,RUSAGE_INFO_V4,(rusage_info_t *)&usage)!=0) return 0;
  *start=usage.ri_proc_start_abstime; return 1;
}
static napi_value process_identity(napi_env env,napi_callback_info info) {
  size_t argc=1; napi_value argv[1],result,start; pid_t pid; uint64_t birth=0;
  napi_get_cb_info(env,info,&argc,argv,NULL,NULL);
  if(argc!=1 || !pid_argument(env,argv[0],&pid)) return fail(env,"package-manager process identity requires a PID");
  // An ended process has no identity, so its nodes can never be claimed.
  if(!process_start(pid,&birth)) { napi_get_undefined(env,&result); return result; }
  napi_create_object(env,&result); set_number(env,result,"pid",pid);
  napi_create_bigint_uint64(env,birth,&start); napi_set_named_property(env,result,"startAbstime",start); return result;
}
static napi_value bound_descendant(napi_env env,napi_callback_info info) {
  size_t argc=3; napi_value argv[3],result,value; pid_t peer,root; uint32_t peer_version=0; uint64_t bound=0,birth=0; bool lossless=false; audit_token_t audit;
  napi_get_cb_info(env,info,&argc,argv,NULL,NULL);
  int valid=argc==3 && pid_argument(env,argv[0],&peer) && napi_get_value_uint32(env,argv[1],&peer_version)==napi_ok &&
    napi_get_named_property(env,argv[2],"pid",&value)==napi_ok && pid_argument(env,value,&root) &&
    napi_get_named_property(env,argv[2],"startAbstime",&value)==napi_ok && napi_get_value_bigint_uint64(env,value,&bound,&lossless)==napi_ok && lossless;
  // The message audit version pins the helper's current image. The root is the bound process instance, whatever image it now runs.
  valid=valid && process_audit(peer,&audit) && audit.val[7]==peer_version;
  // One live parent chain read at claim time; intermediate hops compare nothing, the root hop compares its monotonic birth.
  while(valid && peer!=root) {
    struct proc_bsdinfo process;
    if(proc_pidinfo(peer,PROC_PIDTBSDINFO,0,&process,sizeof process)!=sizeof process || process.pbi_ppid<=1) { valid=0; break; }
    peer=(pid_t)process.pbi_ppid;
  }
  valid=valid && process_start(root,&birth) && birth==bound;
  napi_get_boolean(env,valid,&result); return result;
}
napi_value register_package_manager_exports(napi_env env,napi_value exports) {
  napi_property_descriptor properties[]={
    {"startPackageManagerService",NULL,start_service,NULL,NULL,NULL,napi_default,NULL},
    {"closePackageManagerService",NULL,close_service,NULL,NULL,NULL,napi_default,NULL},
    {"packageManagerProcessIdentity",NULL,process_identity,NULL,NULL,NULL,napi_default,NULL},
    {"packageManagerBoundDescendant",NULL,bound_descendant,NULL,NULL,NULL,napi_default,NULL},
  };
  napi_define_properties(env,exports,sizeof properties/sizeof properties[0],properties);
  return exports;
}
