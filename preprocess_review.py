import pandas as pd


# 1. Read review JSON
reviews = pd.read_json(
    "/Users/hannayang/Desktop/reviews.json",
    lines=True
)

print("Original review shape:", reviews.shape)


# 2. Read cleaned business CSV
businesses = pd.read_csv("/Users/hannayang/Downloads/businesses_clean.csv")

valid_business_ids = set(businesses["business_id"].dropna().unique())


# 3. Keep only matched businesses
reviews = reviews[reviews["business_id"].isin(valid_business_ids)].copy()

print("After business filter:", reviews.shape)


# 4. Select relevant columns
review_cols = [
    "review_id",
    "business_id",
    "stars",
    "useful",
    "funny",
    "cool",
    "text",
    "date"
]

reviews = reviews[review_cols].copy()


# 5. Drop missing values
reviews = reviews.dropna(subset=["review_id", "business_id", "stars", "text", "date"])

reviews["text"] = reviews["text"].astype(str).str.strip()
reviews = reviews[reviews["text"] != ""]

print("After dropping NA/empty:", reviews.shape)


# 6. Remove duplicates
reviews = reviews.drop_duplicates(subset="review_id")


# 7. Clean date
reviews["date"] = pd.to_datetime(reviews["date"], errors="coerce")
reviews = reviews.dropna(subset=["date"])


# 8. Clean numeric columns
num_cols = ["stars", "useful", "funny", "cool"]

for col in num_cols:
    reviews[col] = pd.to_numeric(reviews[col], errors="coerce")

reviews = reviews.dropna(subset=["stars"])

reviews["useful"] = reviews["useful"].fillna(0).astype(int)
reviews["funny"]  = reviews["funny"].fillna(0).astype(int)
reviews["cool"]   = reviews["cool"].fillna(0).astype(int)


# 9. Basic text cleaning
reviews["text"] = reviews["text"].str.replace(r"\s+", " ", regex=True).str.strip()
reviews = reviews.rename(columns={"date": "review_date"})


# 10. Save cleaned CSV
reviews.to_csv("reviews_clean.csv", index=False)

print("Final shape:", reviews.shape)



