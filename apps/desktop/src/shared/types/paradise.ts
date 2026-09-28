export type TravelGear = 'camera' | 'notebook' | 'thermos';
export type TravelDestination = 'trial' | 'informatics' | 'lake' | 'teaching';
export type Trip = {
  id: string; startedAt: number; mailAt: number; returnsAt: number;
  gear: TravelGear; read: boolean; collected: boolean;
  destination?: TravelDestination;
};
export type World = {
  version: 2; name: string; gear: TravelGear; motion: boolean; trips: Trip[];
  atmosphere?: {season:'auto'|'spring'|'summer'|'autumn'|'winter';weather:'auto'|'sunny'|'cloudy'|'wind'|'rain'|'snow'|'fog'};
};
