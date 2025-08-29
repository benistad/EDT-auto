"use client";
import * as React from "react";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(function Label(
  { className = "", ...props },
  ref
) {
  return <label ref={ref} className={`text-sm font-medium ${className}`} {...props} />;
});

export default Label;
