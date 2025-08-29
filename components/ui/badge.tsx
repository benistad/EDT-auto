"use client";
import * as React from "react";

export const Badge: React.FC<React.HTMLAttributes<HTMLSpanElement> & { variant?: string }> = ({
  className = "",
  variant,
  ...props
}) => (
  <span
    className={`inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 ${className}`}
    {...props}
  />
);

export default Badge;
