async function run() {
  try {
    const res = await fetch('http://localhost:3000/api/status');
    const data = await res.json();
    console.log("=== RUNTIME STATUS ===");
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Fetch failed:", err.message);
  }
}
run();
