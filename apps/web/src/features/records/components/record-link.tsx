"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type ComponentProps } from "react";

type Props<T extends string> = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: Route<T> };

/** Dense tables can expose hundreds of address/transaction links. Warm the destination
 * on intent, once per href, without making every visible row render on the server. */
export function RecordLink<T extends string>({ href, onMouseEnter, onFocus, onTouchStart, ...props }: Props<T>) {
  const router = useRouter();
  const prefetched = useRef<string | null>(null);
  const prefetch = () => {
    if (prefetched.current === href) return;
    prefetched.current = href;
    router.prefetch(href);
  };

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        if (!event.defaultPrevented) prefetch();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented) prefetch();
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        if (!event.defaultPrevented) prefetch();
      }}
    />
  );
}
