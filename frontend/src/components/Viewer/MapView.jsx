import React, { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './MapView.css';

// CHIREC Delta Hospital, Auderghem, Brussels
export const HOSPITAL_LNG = 4.399963172085595;
export const HOSPITAL_LAT = 50.81615342882996;

export default function MapView({ token, mapRef }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!token || !containerRef.current) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard-satellite',
      center: [HOSPITAL_LNG, HOSPITAL_LAT],
      zoom: 17,
      pitch: 60,
      bearing: -30,
      antialias: true,
      interactive: false, // Camera controlled by xeokit sync
    });

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 223)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(11, 11, 25)',
        'star-intensity': 0.6,
      });
    });

    if (mapRef) mapRef.current = map;

    return () => {
      if (mapRef) mapRef.current = null;
      map.remove();
    };
  }, [token]);

  if (!token) {
    return (
      <div className="map-view map-view--no-token">
        <p>Mapbox token not configured.</p>
        <p className="map-view__hint">
          Add <code>VITE_MAPBOX_TOKEN=pk.xxx</code> to <code>frontend/.env</code>
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="map-view" />;
}
