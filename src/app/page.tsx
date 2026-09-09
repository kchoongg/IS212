import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      <h2 className="mb-3 text-2xl font-bold">Welcome to ConnectSphere</h2>
      <p className="mb-6 text-gray-600">
        Event management for ConnectSphere. Log in to see your events, or
        register if you&apos;re new.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className="rounded bg-gray-900 px-4 py-2 text-white">
          Log in
        </Link>
        <Link href="/register" className="rounded border border-gray-300 px-4 py-2">
          Register
        </Link>
      </div>
    </div>
  );
}
