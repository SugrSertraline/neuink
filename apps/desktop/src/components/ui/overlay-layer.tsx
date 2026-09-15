import { createContext, useContext } from 'react';

const OverlayLayerContext = createContext<'popover' | 'dialog-popover'>('popover');
export const OverlayLayerProvider = OverlayLayerContext.Provider;
export const useOverlayLayer = () => useContext(OverlayLayerContext);
