"use client";
import * as React from "react";

type DialogContextType = { open: boolean; setOpen: (v: boolean) => void };
const DialogContext = React.createContext<DialogContextType | null>(null);

export const Dialog: React.FC<React.HTMLAttributes<HTMLDivElement> & { open?: boolean; onOpenChange?: (v: boolean) => void }>
  = ({ children, open: controlledOpen, onOpenChange, ...props }) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (controlledOpen === undefined) setInternalOpen(v);
  };
  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      <div {...props}>{children}</div>
    </DialogContext.Provider>
  );
};

export const DialogTrigger: React.FC<React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }> = ({ children, asChild, ...props }) => {
  const ctx = React.useContext(DialogContext);
  if (!ctx) return <>{children}</>;
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<any>;
    const mergedOnClick = (e: React.MouseEvent) => {
      child.props?.onClick?.(e);
      (props as any)?.onClick?.(e);
      ctx.setOpen(true);
    };
    return React.cloneElement(child, { ...child.props, onClick: mergedOnClick });
  }
  return (
    <div
      {...props}
      onClick={(e) => {
        (props as any)?.onClick?.(e as any);
        ctx.setOpen(true);
      }}
    >
      {children}
    </div>
  );
};

export const DialogContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", children, ...props }) => {
  const ctx = React.useContext(DialogContext);
  if (!ctx || !ctx.open) return null;
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center`}>
      <div className="absolute inset-0 bg-black/30" onClick={() => ctx.setOpen(false)} />
      <div className={`relative z-10 rounded-lg bg-white p-4 shadow-lg ${className}`} {...props}>
        {children}
      </div>
    </div>
  );
};

export const DialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (
  <div className={`mb-2 ${className}`} {...props} />
);

export const DialogTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className = "", ...props }) => (
  <h3 className={`text-lg font-semibold ${className}`} {...props} />
);

export default Dialog;
