import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="auth-page">
      <div className="state-card">
        <h3>That page doesn’t exist</h3>
        <p>The link may be old, or the address was typed a little differently.</p>
        <Link href="/" className="button button-primary">Back to your feed</Link>
      </div>
    </main>
  );
}
