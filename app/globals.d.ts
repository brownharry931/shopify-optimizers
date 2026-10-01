import type { HTMLAttributes } from "react";

declare module "*.css";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": HTMLAttributes<HTMLElement>;
    }
  }
}
