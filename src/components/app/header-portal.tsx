import { createContext, useContext, useState, type ReactNode } from "react";

type HeaderSlots = {
  left: ReactNode;
  right: ReactNode;
};

type HeaderPortalContextValue = {
  slots: HeaderSlots;
  setSlots: (slots: HeaderSlots) => void;
};

const HeaderPortalContext = createContext<HeaderPortalContextValue | null>(null);

export function HeaderPortalProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<HeaderSlots>({ left: null, right: null });
  return (
    <HeaderPortalContext.Provider value={{ slots, setSlots }}>
      {children}
    </HeaderPortalContext.Provider>
  );
}

export function useHeaderSlots() {
  const ctx = useContext(HeaderPortalContext);
  if (!ctx) throw new Error("useHeaderSlots must be used within HeaderPortalProvider");
  return ctx.slots;
}

export function useSetHeaderSlots() {
  const ctx = useContext(HeaderPortalContext);
  if (!ctx) throw new Error("useSetHeaderSlots must be used within HeaderPortalProvider");
  return ctx.setSlots;
}
