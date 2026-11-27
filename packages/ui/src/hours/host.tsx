import { createContext, useContext, type ReactNode } from 'react';

// What the host app hands the Hours screens for the top of the screen. The phone has no top
// bar (its modes are a bottom nav), so each screen's first row starts with the app's name
// and has the screen's own control at the right; Hours' screens draw that row themselves,
// with the name the host gave them. With a brand, Hours also leaves out its own menu: the
// host has the settings and the recurring plans in its menu screen. The web hands nothing
// and gets the headers as they were.
export const BrandContext = createContext<ReactNode>(null);
export const useBrand = (): ReactNode => useContext(BrandContext);
