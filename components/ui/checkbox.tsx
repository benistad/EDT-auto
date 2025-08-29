"use client";
import * as React from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  onCheckedChange?: (checked: boolean) => void;
};

export const Checkbox = React.forwardRef<HTMLInputElement, Props>(function Checkbox(
  { className = "", onCheckedChange, onChange, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={`h-4 w-4 rounded border-gray-300 text-gray-900 ${className}`}
      onChange={(e) => {
        onChange?.(e);
        onCheckedChange?.(e.currentTarget.checked);
      }}
      {...props}
    />
  );
});

export default Checkbox;
