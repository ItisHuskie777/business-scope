import pandas as pd


# 1. Read ZHVI data

df = pd.read_csv("/Users/hannayang/Desktop/zhvi.csv")

print("Original shape:", df.shape)
print(df.head())


# 2. Keep only target states

valid_states = ["PA", "FL", "TN", "IN", "MO", "LA"]
df = df[df["State"].isin(valid_states)].copy()

print("After state filter:", df.shape)
print(df["State"].value_counts())


# 3. Keep only ZIP-level rows

df["RegionType"] = df["RegionType"].astype(str).str.strip().str.lower()
df = df[df["RegionType"] == "zip"].copy()

print("After keeping ZIP rows:", df.shape)
print(df["RegionType"].value_counts())


# 4. Clean postal code
# RegionName is assumed to be ZIP code
df["RegionName"] = (
    df["RegionName"]
    .astype(str)
    .str.strip()
    .str.replace(".0", "", regex=False)
    .str.zfill(5)
)

# only keep valid 5-digit ZIP codes
df = df[df["RegionName"].str.match(r"^\d{5}$", na=False)].copy()


# 5. Clean location/meta columns
meta_cols = ["StateName", "State", "City", "CountyName"]

for col in meta_cols:
    df[col] = df[col].fillna("").astype(str).str.strip()

df["State"] = df["State"].str.upper()


# 6. Build zip_region table
# one row per postal code
zip_region = df[[
    "RegionName",
    "RegionID",
    "RegionName",
    "RegionType",
    "StateName",
    "State",
    "City",
    "CountyName"
]].copy()

zip_region.columns = [
    "postal_code",
    "region_id",
    "region_name",
    "region_type",
    "state_name",
    "state",
    "city",
    "county_name"
]

# remove duplicate ZIP rows if any
zip_region = zip_region.drop_duplicates(subset=["postal_code"]).copy()

print("zip_region shape:", zip_region.shape)
print(zip_region.head())


# 7. Identify monthly ZHVI columns
id_cols = [
    "RegionID",
    "SizeRank",
    "RegionName",
    "RegionType",
    "StateName",
    "State",
    "City",
    "Metro",
    "CountyName"
]

date_cols = [col for col in df.columns if col not in id_cols]

print("Number of monthly columns:", len(date_cols))
print("First few monthly columns:", date_cols[:5])


# 8. Build housing_trend table
# wide -> long
housing_trend = df.melt(
    id_vars=["RegionName"],
    value_vars=date_cols,
    var_name="trend_date",
    value_name="zhvi_value"
)

housing_trend = housing_trend.rename(columns={"RegionName": "postal_code"})


# 9. Clean date and value columns
housing_trend["trend_date"] = pd.to_datetime(housing_trend["trend_date"], errors="coerce")
housing_trend["zhvi_value"] = pd.to_numeric(housing_trend["zhvi_value"], errors="coerce")

housing_trend = housing_trend.dropna(subset=["trend_date", "zhvi_value"]).copy()

# keep only postal codes that exist in zip_region
valid_postal_codes = set(zip_region["postal_code"])
housing_trend = housing_trend[housing_trend["postal_code"].isin(valid_postal_codes)].copy()


# 10. Remove duplicate (postal_code, trend_date)
housing_trend = housing_trend.drop_duplicates(subset=["postal_code", "trend_date"]).copy()


# 11. Sort for readability
zip_region = zip_region.sort_values(["state", "postal_code"]).reset_index(drop=True)
housing_trend = housing_trend.sort_values(["postal_code", "trend_date"]).reset_index(drop=True)


# Save outputs
zip_region.to_csv("zip_region.csv", index=False)
housing_trend.to_csv("housing_trend.csv", index=False)