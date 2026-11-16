# Modeling: scikit-learn patterns

## Pipeline + ColumnTransformer

Encapsulate all preprocessing in a pipeline to prevent data leakage
and make the model deployable as a single unit.

```python
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer

numeric_features = ["age", "income"]
categorical_features = ["dept", "region"]

preprocessor = ColumnTransformer([
    ("num", Pipeline([("imputer", SimpleImputer(strategy="median")),
                      ("scaler", StandardScaler())]), numeric_features),
    ("cat", Pipeline([("imputer", SimpleImputer(strategy="most_frequent"))]), categorical_features),
])

model = Pipeline([
    ("preprocessor", preprocessor),
    ("classifier", RandomForestClassifier(n_estimators=200, max_depth=8)),
])
```

## Train / valid / test split

```python
from sklearn.model_selection import train_test_split, cross_val_score

X_train_val, X_test, y_train_val, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
X_train, X_val, y_train, y_val = train_test_split(X_train_val, y_train_val, test_size=0.2, random_state=42)

model.fit(X_train, y_train)
val_score = model.score(X_val, y_val)  # never evaluate on training data
cv = cross_val_score(model, X_train, y_train, cv=5, scoring="roc_auc")
```

## Tracking

- Track every trial with MLflow (`mlflow-tracking` skill)
- Log: params, metrics, model (with signature), code version, data path + hash

See `mlflow-tracking` skill for full logging patterns.
