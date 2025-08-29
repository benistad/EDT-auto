"use client";
import * as React from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  size?: string;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className = "", variant, size, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-md border border-transparent px-3 py-2 text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 ${className}`}
      {...props}
    />
  );
});

export default Button;
