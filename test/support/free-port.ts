import { createServer } from "node:net";

/** A TCP port nothing is listening on right now, so parallel runs never share a database or server. */
export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer().listen(0, () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no free port"))));
    });
  });
}
