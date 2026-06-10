export default function Home() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1>Privacy Proxy</h1>
        <p>Local privacy proxy for ccload is running.</p>
        <p>
          All requests to <code>/api/*</code> are scanned and forwarded.
        </p>
      </div>
    </div>
  );
}
