"use client";
import * as React from "react";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={`flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus:outline-none ${className}`}
      {...props}
    />
  );
});

export default Input;
