import Link from "next/link";
import { Counter } from "./Counter";
import { NonceManager } from "./NonceManager";

export const Footer = ({ count, appId }: { count: number; appId: string }) => {
  return (
    <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center">
      <div className="font-[family-name:var(--font-geist-mono)] text-sm">
        <Link href="/">Back</Link>
      </div>
      <NonceManager appId={appId} />
      <Counter count={count} />
    </footer>
  );
};
