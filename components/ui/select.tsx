"use client";
import * as React from "react";

type Ctx = { value?: string; onValueChange?: (v: string) => void };
const SelectCtx = React.createContext<Ctx>({});

export const Select: React.FC<{
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
}> = ({ value, defaultValue, onValueChange, children }) => {
  const [val, setVal] = React.useState<string | undefined>(defaultValue);
  const current = value !== undefined ? value : val;
  const set = (v: string) => {
    onValueChange?.(v);
    if (value === undefined) setVal(v);
  };
  return <SelectCtx.Provider value={{ value: current, onValueChange: set }}>{children}</SelectCtx.Provider>;
};

export const SelectTrigger: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (
  <div className={`inline-flex items-center justify-between rounded-md border px-3 py-2 text-sm ${className}`} {...props} />
);

export const SelectValue: React.FC<{ placeholder?: string; className?: string }> = ({ placeholder, className }) => {
  const ctx = React.useContext(SelectCtx);
  return <span className={className}>{ctx.value || placeholder || ""}</span>;
};

export const SelectContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (
  <div className={`mt-2 rounded-md border bg-white p-1 shadow ${className}`} {...props} />
);

export const SelectItem: React.FC<{ value: string } & React.HTMLAttributes<HTMLDivElement>> = ({ value, className = "", children, ...props }) => {
  const ctx = React.useContext(SelectCtx);
  return (
    <div
      role="option"
      data-value={value}
      className={`cursor-pointer rounded px-2 py-1 hover:bg-gray-100 ${className}`}
      onClick={(e) => {
        props.onClick?.(e);
        ctx.onValueChange?.(value);
      }}
    >
      {children}
    </div>
  );
};

export default Select;
