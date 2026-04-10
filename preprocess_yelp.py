import pandas as pd
import json


# 1. Read JSON (line by line)
data = []
with open("/Users/hannayang/Desktop/yelp.json", "r") as f:   # 改路径
    for line in f:
        data.append(json.loads(line))

df = pd.DataFrame(data)

print("Original shape:", df.shape)


# 2. Select columns
df = df[[
    "business_id",
    "name",
    "address",
    "city",
    "state",
    "postal_code",
    "stars",
    "is_open",
    "categories",
    "hours"
]].copy()


# 3. Clean postal_code
df["postal_code"] = (
    df["postal_code"]
    .astype(str)
    .str.strip()
    .str.replace(".0", "", regex=False)
    .str.zfill(5)
)
df = df[df["postal_code"].str.match(r"^\d{5}$", na=False)]


# 4. Clean string columns
for col in ["name", "address", "city", "categories"]:
    df[col] = df[col].fillna("").astype(str).str.strip()

df["state"] = df["state"].fillna("").astype(str).str.upper()


# 5. Clean numeric columns
df["stars"] = pd.to_numeric(df["stars"], errors="coerce")
df["is_open"] = pd.to_numeric(df["is_open"], errors="coerce").fillna(0).astype(int)


# 7. Drop duplicates
df = df.drop_duplicates(subset="business_id")


# 8. Drop critical missing
df = df.dropna(subset=["business_id", "name", "postal_code"])


# 9. Final check
print("Final shape:", df.shape)
print(df.isnull().sum())
print(df.head())


# 10. Save CSV
df.to_csv("business_clean.csv", index=False)