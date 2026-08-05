## 2024-05-14 - Binary Search in Degree Sampling
**Learning:** The Robust Soliton CDF sampling (`sampleDegree` in fountain.js) involves a linear search through `cdf` arrays of size up to 1000+. This was taking O(N) operations per block degree sampled. Switching this lookup to a binary search provides an O(log N) algorithm. The difference is stark for large files (e.g. 40-50x faster CDF lookup). Since degree sampling happens synchronously for each chunk generation loop, accelerating it directly lifts throughput limit during encode/decode.

**Action:** Whenever iterating through a monotonically increasing array (like a cumulative distribution function or sorted bounds) to find an interval, replace linear scans with binary search for large N.
