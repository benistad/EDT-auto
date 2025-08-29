"use client";
import * as React from "react";

type Props = { value?: number } & React.HTMLAttributes<HTMLDivElement>;

export const Progress: React.FC<Props> = ({ value = 0, className = "", ...props }) => (
  <div className={`w-full h-2 bg-gray-200 rounded ${className}`} {...props}>
    <div className="h-2 bg-gray-900 rounded" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

export default Progress;
