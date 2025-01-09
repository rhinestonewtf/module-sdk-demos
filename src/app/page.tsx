import Image from "next/image";

export default function Home() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <div className="flex flex-row items-center align-center">
          <Image
            className="dark:invert"
            src="/rhinestone.svg"
            alt="Rhinestone logo"
            width={180}
            height={38}
            priority
          />{" "}
          <span className="text-lg font-bold">Module SDK Demos</span>
        </div>
        <ul className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2">
            <a href="/smart-sessions" className="underline">
              Smart Sessions
            </a>
          </li>
          <li className="mb-2">
            <a href="/eip-7702" className="underline">
              EIP-7702
            </a>
          </li>
          <li className="mb-2">
            <a href="/webauthn" className="underline">
              Webauthn
            </a>
          </li>
        </ul>
      </main>
      <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center">
        <div>
          <a href="https://docs.rhinestone.wtf/">Docs</a>
        </div>
        <div>
          <a href="https://github.com/rhinestonewtf/module-sdk-demos">
            Source Code
          </a>
        </div>
      </footer>
    </div>
  );
}
