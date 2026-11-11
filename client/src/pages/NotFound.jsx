import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container page-head" style={{ paddingBottom: 96 }}>
      <h1>Page not found</h1>
      <p>That page doesn’t exist.</p>
      <p style={{ marginTop: 24 }}><Link className="btn btn-primary" to="/">Go to the converter</Link></p>
    </div>
  );
}
