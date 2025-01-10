import { LoadingSpinner } from "./LoadingSpinner";

export const Button = ({
  buttonText,
  onClick,
  isLoading,
  disabled,
}: {
  buttonText: string;
  onClick: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] hover:border-transparent !text-sm sm:text-base h-8 sm:h-12 px-4 sm:px-5 sm:min-w-44 font-[family-name:var(--font-geist-mono)]"
    >
      {isLoading ? <LoadingSpinner /> : buttonText}
    </button>
  );
};
