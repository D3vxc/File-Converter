export default function Privacy() {
  return (
    <div className="container prose" style={{ paddingBottom: 72 }}>
      <div className="page-head"><h1>Privacy</h1></div>
      <p>Morph has no accounts, no ads and no tracking.</p>
      <h2>Your files</h2>
      <p>Simple image conversions happen in your browser, so those files never leave your device. Other files are uploaded, converted, and deleted automatically after 60 minutes, or right away when you remove them from the list.</p>
      <h2>Metadata</h2>
      <p>Photo EXIF and GPS data is removed by default when converting images, unless you choose to keep it.</p>
    </div>
  );
}
