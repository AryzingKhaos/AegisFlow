declare module "node:fs" {
  export interface Stats {
    isDirectory(): boolean;
  }

  export interface Dirent {
    name: string;
    isDirectory(): boolean;
  }

  export const promises: {
    stat(path: string): Promise<Stats>;
    mkdir(
      path: string,
      options?: {
        recursive?: boolean;
      },
    ): Promise<void>;
    writeFile(path: string, data: string, encoding?: string): Promise<void>;
    readFile(path: string, encoding?: string): Promise<string>;
    appendFile(path: string, data: string, encoding?: string): Promise<void>;
    readdir(
      path: string,
      options?: {
        withFileTypes?: boolean;
      },
    ): Promise<Dirent[]>;
  };
}

declare module "node:path" {
  interface PathModule {
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
    dirname(path: string): string;
  }

  const path: PathModule;
  export = path;
}

declare module "node:events" {
  export class EventEmitter {
    on(eventName: string, listener: (...args: any[]) => void): this;
    emit(eventName: string, ...args: any[]): boolean;
    removeAllListeners(eventName?: string): this;
  }
}

declare module "node:readline" {
  import { EventEmitter } from "node:events";

  export interface ReadLine extends EventEmitter {
    setPrompt(prompt: string): void;
    prompt(): void;
    close(): void;
    on(eventName: "line", listener: (line: string) => void): this;
    on(eventName: "SIGINT", listener: () => void): this;
    on(eventName: "close", listener: () => void): this;
  }

  export function createInterface(options: {
    input: unknown;
    output: unknown;
  }): ReadLine;

  const readline: {
    createInterface: typeof createInterface;
  };

  export default readline;
}

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  stdin: unknown;
  stdout: unknown;
  exitCode: number;
};

declare const console: {
  log(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
};
