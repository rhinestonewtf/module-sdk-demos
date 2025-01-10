import { Counter } from "./Counter";
import { NonceManager } from "./NonceManager";

export const Footer = ({ count }: { count: number }) => {
  return (
    <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center">
      <NonceManager />
      <Counter count={count} />
    </footer>
  );
};
