import type { ReactNode } from "react";

// CrewLayout's real sheet and tutorial dialog portal through Radix.
// JSDOM rejects the custom events those layers dispatch, so navigation tests
// render the options inline and skip the invite dialog.
export function Sheet({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
export function SheetContent({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}
export function SheetHeader({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}
export function SheetTitle({ children }: { children?: ReactNode }) {
  return <h2>{children}</h2>;
}
export function TutorialInviteDialog() {
  return null;
}
