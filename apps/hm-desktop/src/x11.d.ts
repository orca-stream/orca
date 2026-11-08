// node-x11 ships no types; the app only opens a client (see startup-notification.ts).
declare module "x11" {
  const x11: {
    createClient(callback: (err: unknown, display: never) => void): void;
  };
  export default x11;
}
