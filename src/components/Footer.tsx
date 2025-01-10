import { Counter } from "./Counter";
import { NonceManager } from "./NonceManager";

export const Footer = ({ count, appId }: { count: number; appId: string }) => {
  return (
    <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center">
      <NonceManager appId={appId} />
      <Counter count={count} />
    </footer>
  );
};
