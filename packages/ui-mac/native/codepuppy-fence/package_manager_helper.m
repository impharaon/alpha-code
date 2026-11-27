#import <Foundation/Foundation.h>
#include <servers/bootstrap.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include "package_manager_ipc.h"

static int broker;
static pthread_mutex_t output_lock=PTHREAD_MUTEX_INITIALIZER;
static int write_all(int fd,const void *data,size_t size) {
  const char *bytes=data;
  while(size) { ssize_t count=write(fd,bytes,size); if(count<0 && errno==EINTR) continue; if(count<=0) return 0; bytes+=count; size-=(size_t)count; }
  return 1;
}
static int error_exit(const char *error) { dprintf(STDERR_FILENO,"codepuppy package-manager: %s\n",error); return 126; }
static int frame(NSDictionary *value) {
  NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
  if(!data) return 0;
  char size[32]; int length=snprintf(size,sizeof size,"%zx\r\n",data.length+1);
  pthread_mutex_lock(&output_lock);
  int sent=write_all(broker,size,(size_t)length) && write_all(broker,data.bytes,data.length) && write_all(broker,"\n\r\n",3);
  pthread_mutex_unlock(&output_lock); return sent;
}
static void *stream_stdin(void *data) { @autoreleasepool {
  int closed=*(int*)data; char bytes[16384];
  while(!closed) { @autoreleasepool {
    ssize_t count=read(STDIN_FILENO,bytes,sizeof bytes);
    if(count<0 && errno==EINTR) continue;
    if(count<=0) break;
    if(!frame(@{@"type":@"stdin",@"dataBase64":[[NSData dataWithBytes:bytes length:(NSUInteger)count] base64EncodedStringWithOptions:0]})) return NULL;
  } }
  frame(@{@"type":@"stdin-eof"});
  pthread_mutex_lock(&output_lock); write_all(broker,"0\r\n\r\n",5); pthread_mutex_unlock(&output_lock);
  return NULL;
} }
static NSString *read_line(int fd) {
  NSMutableData *data=[NSMutableData data]; char byte;
  for(;;) {
    ssize_t count=read(fd,&byte,1); if(count<0 && errno==EINTR) continue; if(count!=1) return nil;
    if(byte=='\n') break; [data appendBytes:&byte length:1];
  }
  if(data.length && ((const char*)data.bytes)[data.length-1]=='\r') data.length--;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}
static int read_bytes(int fd,void *buffer,size_t size) {
  char *bytes=buffer;
  while(size) { ssize_t count=read(fd,bytes,size); if(count<0 && errno==EINTR) continue; if(count<=0) return 0; bytes+=count; size-=(size_t)count; }
  return 1;
}
static NSDictionary *read_frame(NSMutableData *pending) {
  for(;;) {
    const unsigned char *bytes=pending.bytes; NSUInteger newline=0;
    while(newline<pending.length && bytes[newline]!='\n') newline++;
    if(newline<pending.length) {
      NSData *line=[pending subdataWithRange:NSMakeRange(0,newline)];
      [pending replaceBytesInRange:NSMakeRange(0,newline+1) withBytes:NULL length:0];
      id value=[NSJSONSerialization JSONObjectWithData:line options:0 error:NULL];
      return [value isKindOfClass:NSDictionary.class]?value:nil;
    }
    NSString *header=read_line(broker); if(!header) return nil;
    const char *raw=header.UTF8String; char *end=NULL; errno=0; unsigned long long size=strtoull(raw,&end,16);
    if(errno || end==raw || (*end && *end!=';') || size>NSUIntegerMax || size==0) return nil;
    NSMutableData *chunk=[NSMutableData dataWithLength:(NSUInteger)size];
    char crlf[2]; if(!read_bytes(broker,chunk.mutableBytes,chunk.length) || !read_bytes(broker,crlf,2) || memcmp(crlf,"\r\n",2)) return nil;
    [pending appendData:chunk];
  }
}
static int claim(const char *service,const char *execution,const char *node,int proof_fd,pm_grant_message *grant) {
  pm_claim_message message={0};
  if(strlen(execution)>=sizeof message.execution || strlen(node)>=sizeof message.node) return 0;
  strlcpy(message.execution,execution,sizeof message.execution); strlcpy(message.node,node,sizeof message.node);
  char proof[66]={0}; size_t length=0;
  for(;;) {
    char byte; ssize_t count=read(proof_fd,&byte,1);
    if(count<0 && errno==EINTR) continue;
    if(count!=1 || length==sizeof proof-1) break;
    proof[length++]=byte;
  }
  close(proof_fd);
  if(length==65 && proof[64]=='\n') { proof[64]=0; strlcpy(message.proof,proof,sizeof message.proof); }
  pm_clear(proof,sizeof proof);
  // No original 3+ descriptors or internal proof descriptors survive into the helper's transport.
  int size=proc_pidinfo(getpid(),PROC_PIDLISTFDS,0,NULL,0);
  if(size<=0) return 0;
  struct proc_fdinfo *descriptors=malloc((size_t)size);
  if(!descriptors) return 0;
  int count=proc_pidinfo(getpid(),PROC_PIDLISTFDS,0,descriptors,size);
  if(count<=0) { free(descriptors); return 0; }
  for(int index=0;index<count/(int)sizeof(*descriptors);index++) if(descriptors[index].proc_fd>=3) close(descriptors[index].proc_fd);
  free(descriptors);
  mach_port_t port=MACH_PORT_NULL,reply=MACH_PORT_NULL;
  if(bootstrap_look_up(bootstrap_port,(char*)service,&port)!=KERN_SUCCESS || mach_port_allocate(mach_task_self(),MACH_PORT_RIGHT_RECEIVE,&reply)!=KERN_SUCCESS) { pm_clear(message.proof,sizeof message.proof); return 0; }
  message.header.msgh_bits=MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND,MACH_MSG_TYPE_MAKE_SEND_ONCE);
  message.header.msgh_size=sizeof message; message.header.msgh_remote_port=port; message.header.msgh_local_port=reply; message.header.msgh_id=1759;
  kern_return_t result=mach_msg(&message.header,MACH_SEND_MSG,sizeof message,0,MACH_PORT_NULL,0,MACH_PORT_NULL);
  pm_clear(message.proof,sizeof message.proof); mach_port_deallocate(mach_task_self(),port);
  if(result==KERN_SUCCESS) {
    struct { pm_grant_message grant; mach_msg_max_trailer_t trailer; } response={0};
    result=mach_msg(&response.grant.header,MACH_RCV_MSG,0,sizeof response,reply,0,MACH_PORT_NULL);
    if(result==KERN_SUCCESS && response.grant.header.msgh_size==sizeof(pm_grant_message)) { *grant=response.grant; pm_clear(response.grant.authorization,sizeof response.grant.authorization); }
    else result=KERN_FAILURE;
  }
  mach_port_mod_refs(mach_task_self(),reply,MACH_PORT_RIGHT_RECEIVE,-1); return result==KERN_SUCCESS;
}
int main(int argc,char **argv) { @autoreleasepool {
  int stdin_closed=fcntl(STDIN_FILENO,F_GETFD)<0 && errno==EBADF;
  if(argc<11 || strcmp(argv[1],"--service") || strcmp(argv[3],"--execution") || strcmp(argv[5],"--node") || strcmp(argv[7],"--proof-fd") || strcmp(argv[9],"--") || strlen(argv[8])!=1 || argv[8][0]<'3' || argv[8][0]>'9') return error_exit("unauthorized");
  pm_grant_message grant={0};
  if(!claim(argv[2],argv[4],argv[6],argv[8][0]-'0',&grant)) return error_exit("unauthorized");
  if(grant.kind==PM_FENCED) { pm_clear(grant.authorization,sizeof grant.authorization); execvp(argv[10],&argv[10]); return errno==ENOENT?127:126; }
  if(grant.kind!=PM_DELEGATED) return error_exit(grant.kind==PM_INACTIVE?"inactive-execution":grant.kind==PM_CONSUMED?"node-consumed":"unauthorized");
  if(grant.port==0 || grant.port>65535 || strnlen(grant.authorization,sizeof grant.authorization)!=64) return error_exit("unauthorized");
  broker=socket(AF_INET,SOCK_STREAM,0); if(broker<0) return error_exit("unavailable");
  if(broker<3) { int copy=fcntl(broker,F_DUPFD_CLOEXEC,3); close(broker); broker=copy; if(broker<0) return error_exit("unavailable"); }
  int one=1; setsockopt(broker,SOL_SOCKET,SO_NOSIGPIPE,&one,sizeof one);
  struct sockaddr_in address={0}; address.sin_family=AF_INET; address.sin_port=htons((uint16_t)grant.port); address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
  if(connect(broker,(const struct sockaddr*)&address,sizeof address)!=0) return error_exit("unavailable");
  char head[512]; int length=snprintf(head,sizeof head,"POST /codepuppy/package-manager/process HTTP/1.1\r\nHost: 127.0.0.1:%u\r\nAuthorization: Bearer %s\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",grant.port,grant.authorization);
  int sent=write_all(broker,head,(size_t)length); pm_clear(head,sizeof head); pm_clear(grant.authorization,sizeof grant.authorization);
  if(!sent || !frame(@{@"executionID":[NSString stringWithUTF8String:argv[4]],@"nodeID":[NSString stringWithUTF8String:argv[6]]})) return error_exit("unavailable");
  NSString *status=read_line(broker); BOOL accepted=[status hasPrefix:@"HTTP/1.1 200 "]; long long content_length=-1;
  for(;;) {
    NSString *header=read_line(broker); if(!header) return error_exit("unavailable"); if(!header.length) break;
    if([header.lowercaseString hasPrefix:@"content-length:"]) content_length=[[header substringFromIndex:15] longLongValue];
  }
  if(!accepted) {
    // Broker errors are closed stable codes; arbitrary response material is never echoed.
    const char *error=[status containsString:@" 401 "]?"unauthorized":[status containsString:@" 403 "]?"node-mismatch":[status containsString:@" 409 "]?"inactive-execution":"invalid-request";
    if(content_length>0 && (unsigned long long)content_length<=NSUIntegerMax) {
      NSMutableData *body=[NSMutableData dataWithLength:(NSUInteger)content_length];
      if(read_bytes(broker,body.mutableBytes,body.length)) {
        id value=[NSJSONSerialization JSONObjectWithData:body options:0 error:NULL];
        if([value isKindOfClass:NSDictionary.class]) {
          id code=value[@"error"];
          for(NSString *allowed in @[@"invalid-request",@"unauthorized",@"node-mismatch",@"inactive-execution",@"node-consumed"]) if([allowed isEqual:code]) return error_exit(allowed.UTF8String);
        }
      }
    }
    return error_exit(error);
  }
  NSMutableData *pending=[NSMutableData data]; pthread_t reader; int reading=0,code=126,signal_number=0; unsigned long long sequence=0;
  for(;;) { @autoreleasepool {
    NSDictionary *event=read_frame(pending); if(!event) { error_exit("unavailable"); break; }
    NSString *type=event[@"type"];
    if([type isEqual:@"fenced"]) {
      if(reading) { error_exit("invalid-request"); break; }
      close(broker); execvp(argv[10],&argv[10]); return errno==ENOENT?127:126;
    }
    if([type isEqual:@"stdout"] || [type isEqual:@"stderr"]) {
      if(![event[@"seq"] isKindOfClass:NSNumber.class] || [event[@"seq"] unsignedLongLongValue]!=sequence++ || ![event[@"dataBase64"] isKindOfClass:NSString.class]) { error_exit("invalid-request"); break; }
      NSData *bytes=[[NSData alloc] initWithBase64EncodedString:event[@"dataBase64"] options:0]; if(!bytes) { error_exit("invalid-request"); break; }
      if(!reading) { if(pthread_create(&reader,NULL,stream_stdin,&stdin_closed)!=0) { error_exit("unavailable"); break; } reading=1; }
      if(!write_all([type isEqual:@"stdout"]?STDOUT_FILENO:STDERR_FILENO,bytes.bytes,bytes.length)) break;
      continue;
    }
    if([type isEqual:@"exit"]) {
      if([event[@"exitCode"] isKindOfClass:NSNumber.class]) code=[event[@"exitCode"] intValue];
      NSString *name=event[@"signal"];
      if([name isKindOfClass:NSString.class]) for(int value=1;value<NSIG;value++) if([name caseInsensitiveCompare:[@"SIG" stringByAppendingString:[NSString stringWithUTF8String:sys_signame[value]]]]==NSOrderedSame) signal_number=value;
      break;
    }
    if([type isEqual:@"stopped"]) { error_exit("inactive-execution"); break; }
    error_exit("invalid-request"); break;
  } }
  shutdown(broker,SHUT_RDWR); if(reading) { pthread_cancel(reader); pthread_join(reader,NULL); } close(broker);
  if(signal_number) { signal(signal_number,SIG_DFL); raise(signal_number); return 128+signal_number; }
  return code;
} }
