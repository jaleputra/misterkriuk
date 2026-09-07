import React, { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  MapPin,
  Crosshair,
  Maximize2,
  Minimize2,
  Navigation,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { saveBranchLocation, calculateDistanceMeters } from "@/lib/attendance";

interface AttendanceLocationPickerMapProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  branchName: string;
  address?: string;
  readOnly?: boolean;
  cashierCoords?: { latitude: number; longitude: number; accuracy?: number } | null;
  onChangeCoordinates?: (coords: {
    latitude: number;
    longitude: number;
    address?: string;
  }) => void;
  className?: string;
}

type MapLayerType = "hybrid" | "satellite" | "streets";

export const AttendanceLocationPickerMap: React.FC<AttendanceLocationPickerMapProps> = ({
  latitude,
  longitude,
  radiusMeters,
  branchName,
  address,
  readOnly = false,
  cashierCoords,
  onChangeCoordinates,
  className = "",
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const userLocationMarkerRef = useRef<L.Marker | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const [activeLayer, setActiveLayer] = useState<MapLayerType>("hybrid");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [detectedUserGps, setDetectedUserGps] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    distanceToBranch: number;
  } | null>(null);

  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number }>({
    lat: latitude && !isNaN(latitude) ? latitude : -6.2,
    lng: longitude && !isNaN(longitude) ? longitude : 106.816666,
  });

  // Sinkronisasi koordinat internal saat props latitude / longitude berubah dari luar
  useEffect(() => {
    if (latitude && longitude && !isNaN(latitude) && !isNaN(longitude)) {
      setCurrentCoords({ lat: latitude, lng: longitude });

      if (markerRef.current && circleRef.current && mapInstanceRef.current) {
        const newLatLng = new L.LatLng(latitude, longitude);
        markerRef.current.setLatLng(newLatLng);
        circleRef.current.setLatLng(newLatLng);
        circleRef.current.setRadius(radiusMeters || 100);

        const curCenter = mapInstanceRef.current.getCenter();
        const dist = curCenter.distanceTo(newLatLng);
        if (dist > 80) {
          mapInstanceRef.current.panTo(newLatLng, { animate: true });
        }
      }
    }
  }, [latitude, longitude]);

  // Sinkronisasi radius geofence saat props radiusMeters berubah
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.setRadius(radiusMeters || 100);
    }
  }, [radiusMeters]);

  // Sinkronisasi posisi kasir jika disediakan (misal di halaman Absensi)
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const coordsToDisplay = cashierCoords || (detectedUserGps ? {
      latitude: detectedUserGps.lat,
      longitude: detectedUserGps.lng,
      accuracy: detectedUserGps.accuracy,
    } : null);

    if (coordsToDisplay) {
      const lat = coordsToDisplay.latitude;
      const lng = coordsToDisplay.longitude;
      const acc = coordsToDisplay.accuracy || 10;

      if (userLocationMarkerRef.current) {
        userLocationMarkerRef.current.setLatLng([lat, lng]);
      } else {
        const userMarker = L.marker([lat, lng], {
          icon: createUserGpsIcon(),
          zIndexOffset: 1000,
        })
          .bindTooltip(`Posisi Anda Saat Ini (Akurasi ±${acc}m)`, {
            permanent: false,
            direction: "top",
          })
          .addTo(mapInstanceRef.current);
        userLocationMarkerRef.current = userMarker;
      }
    }
  }, [cashierCoords, detectedUserGps]);

  // Buat custom SVG pin icon untuk titik target cabang
  const createBranchIcon = (name: string) => {
    return L.divIcon({
      className: "custom-branch-marker-container",
      html: `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%); cursor: ${readOnly ? "default" : "grab"};">
          <div style="
            background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
            color: white;
            padding: 4px 10px;
            border-radius: 9999px;
            font-size: 11px;
            font-weight: 800;
            white-space: nowrap;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            border: 1.5px solid #ffffff;
            margin-bottom: 2px;
            display: flex;
            align-items: center;
            gap: 4px;
          ">
            <span>📍 Titik Toko: ${name}</span>
          </div>
          <div style="
            width: 34px;
            height: 34px;
            background: radial-gradient(circle at 35% 35%, #f87171, #dc2626);
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 2.5px solid #ffffff;
            box-shadow: 0 6px 16px rgba(220, 38, 38, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <div style="
              width: 10px;
              height: 10px;
              background: white;
              border-radius: 50%;
              transform: rotate(45deg);
            "></div>
          </div>
          <div style="
            width: 14px;
            height: 5px;
            background: rgba(0,0,0,0.4);
            border-radius: 50%;
            margin-top: 1px;
            filter: blur(1px);
          "></div>
        </div>
      `,
      iconSize: [34, 52],
      iconAnchor: [0, 0],
    });
  };

  // Buat custom SVG pin icon untuk lokasi GPS perangkat
  const createUserGpsIcon = () => {
    return L.divIcon({
      className: "custom-user-gps-marker",
      html: `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; transform: translate(-50%, -50%);">
          <div style="
            position: absolute;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: rgba(37, 99, 235, 0.3);
            border: 1.5px solid rgba(37, 99, 235, 0.6);
            animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          "></div>
          <div style="
            width: 16px;
            height: 16px;
            background: #2563eb;
            border: 2.5px solid #ffffff;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            z-index: 10;
          "></div>
          <div style="
            position: absolute;
            top: 20px;
            background: #1e3a8a;
            color: white;
            padding: 2px 6px;
            border-radius: 6px;
            font-size: 9px;
            font-weight: bold;
            white-space: nowrap;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            border: 1px solid white;
          ">
            Posisi Anda
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [0, 0],
    });
  };

  // Simpan otomatis ke sistem dan database setiap kali titik diubah
  const autoCommitCoordinates = (lat: number, lng: number, customAddress?: string) => {
    const formattedLat = Number(lat.toFixed(6));
    const formattedLng = Number(lng.toFixed(6));
    const addr = customAddress || address || branchName;

    // Simpan ke storage dan database
    saveBranchLocation({
      branch_name: branchName,
      latitude: formattedLat,
      longitude: formattedLng,
      radius_meters: radiusMeters || 100,
      address: addr,
    });

    setLastSavedTime(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));

    if (onChangeCoordinates) {
      onChangeCoordinates({
        latitude: formattedLat,
        longitude: formattedLng,
        address: addr,
      });
    }
  };

  // Fungsi reverse-geocoding via OpenStreetMap Nominatim
  const performReverseGeocode = async (lat: number, lng: number) => {
    setIsReverseGeocoding(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { Accept: "application/json" } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.display_name) {
          autoCommitCoordinates(lat, lng, data.display_name);
          return;
        }
      }
    } catch (e) {
      console.warn("Reverse geocode warning:", e);
    } finally {
      setIsReverseGeocoding(false);
    }

    autoCommitCoordinates(lat, lng);
  };

  // Setup Tile Layer
  const getTileLayer = (layerType: MapLayerType) => {
    if (layerType === "hybrid") {
      // Google Hybrid: Satelit dengan label jalan & gedung akurat
      return L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
        maxZoom: 20,
        attribution: "&copy; Google Maps",
      });
    } else if (layerType === "satellite") {
      // Esri World Imagery (Clean Satellite)
      return L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "&copy; Esri, Maxar, Earthstar Geographics",
        }
      );
    } else {
      // OpenStreetMap Standard
      return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      });
    }
  };

  // Switch Layer
  const handleLayerChange = (layerType: MapLayerType) => {
    setActiveLayer(layerType);
    if (!mapInstanceRef.current) return;

    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }

    const newLayer = getTileLayer(layerType);
    newLayer.addTo(mapInstanceRef.current);
    tileLayerRef.current = newLayer;
  };

  // Inisialisasi Peta Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = latitude && !isNaN(latitude) ? latitude : -6.2;
    const initialLng = longitude && !isNaN(longitude) ? longitude : 106.816666;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 17,
      zoomControl: false,
      attributionControl: false,
    });

    const baseLayer = getTileLayer(activeLayer);
    baseLayer.addTo(map);
    tileLayerRef.current = baseLayer;

    // Lingkaran radius toleransi geofence
    const circle = L.circle([initialLat, initialLng], {
      radius: radiusMeters || 100,
      color: "#ef4444",
      weight: 2,
      fillColor: "#ef4444",
      fillOpacity: 0.16,
      dashArray: "6, 8",
    }).addTo(map);
    circleRef.current = circle;

    // Marker cabang
    const marker = L.marker([initialLat, initialLng], {
      icon: createBranchIcon(branchName),
      draggable: !readOnly,
      autoPan: true,
    }).addTo(map);
    markerRef.current = marker;

    // Dragging marker: Lingkaran ikut bergerak real-time
    if (!readOnly) {
      marker.on("drag", (e: any) => {
        const pos = e.target.getLatLng();
        circle.setLatLng(pos);
        setCurrentCoords({ lat: pos.lat, lng: pos.lng });
      });

      // Selesai drag marker: Simpan koordinat dan geocode
      marker.on("dragend", (e: any) => {
        const pos = e.target.getLatLng();
        const lat = Number(pos.lat.toFixed(6));
        const lng = Number(pos.lng.toFixed(6));
        setCurrentCoords({ lat, lng });
        performReverseGeocode(lat, lng);
        toast.success(
          `Titik absen ${branchName} berhasil digeser ke: ${lat.toFixed(5)}, ${lng.toFixed(5)} dan disimpan!`
        );
      });

      // KLIK LANGSUNG PADA PETA (Direct Manual Pointing)
      map.on("click", (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        const formattedLat = Number(lat.toFixed(6));
        const formattedLng = Number(lng.toFixed(6));

        marker.setLatLng([formattedLat, formattedLng]);
        circle.setLatLng([formattedLat, formattedLng]);
        setCurrentCoords({ lat: formattedLat, lng: formattedLng });

        performReverseGeocode(formattedLat, formattedLng);
        toast.success(
          `Titik absen ${branchName} ditentukan: ${formattedLat.toFixed(5)}, ${formattedLng.toFixed(5)} (Tersimpan)`
        );
      });
    }

    mapInstanceRef.current = map;

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update nama cabang pada icon marker jika branchName berubah
  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setIcon(createBranchIcon(branchName));
    }
  }, [branchName]);

  // Handle Resize / Fullscreen
  useEffect(() => {
    if (mapInstanceRef.current) {
      const timer = setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isFullscreen]);

  // Pusatkan peta ke titik cabang saat ini
  const handleRecenter = () => {
    if (mapInstanceRef.current && currentCoords) {
      mapInstanceRef.current.flyTo([currentCoords.lat, currentCoords.lng], 18, {
        animate: true,
        duration: 1,
      });
    }
  };

  // Cek lokasi GPS perangkat saat ini (HANYA MENAMPILKAN TITIK SAYA, TIDAK MENIMPA TITIK CABANG)
  const handleCheckMyGpsLocation = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      toast.error("Browser tidak mendukung geolokasi GPS");
      return;
    }

    setIsLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocatingUser(false);
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const accuracy = Math.round(pos.coords.accuracy);

        if (!mapInstanceRef.current) return;

        // Hitung jarak perangkat ke titik cabang target
        const dist = calculateDistanceMeters(lat, lng, currentCoords.lat, currentCoords.lng);

        setDetectedUserGps({
          lat,
          lng,
          accuracy,
          distanceToBranch: dist,
        });

        // Tampilkan marker GPS pengguna dengan warna biru
        if (userLocationMarkerRef.current) {
          userLocationMarkerRef.current.setLatLng([lat, lng]);
        } else {
          const userMarker = L.marker([lat, lng], {
            icon: createUserGpsIcon(),
            zIndexOffset: 1000,
          })
            .bindTooltip(`Posisi Anda Saat Ini (Akurasi ±${accuracy}m)\nJarak ke Toko: ${dist}m`, {
              permanent: false,
              direction: "top",
            })
            .addTo(mapInstanceRef.current);
          userLocationMarkerRef.current = userMarker;
        }

        // Tampilkan kedua titik di peta secara nyaman
        const bounds = L.latLngBounds([
          [lat, lng],
          [currentCoords.lat, currentCoords.lng],
        ]);
        mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });

        const isInside = dist <= (radiusMeters || 100);
        if (isInside) {
          toast.success(
            `Posisi Anda terdeteksi di dalam radius! Jarak: ${dist}m dari titik toko ${branchName} (Radius: ${radiusMeters}m)`
          );
        } else {
          toast.info(
            `Posisi Anda: ${dist}m dari titik toko ${branchName} (Toleransi radius: ${radiusMeters}m). Titik toko tetap berada di pin merah.`
          );
        }
      },
      (err) => {
        setIsLocatingUser(false);
        toast.error(`Gagal mendeteksi GPS: ${err.message || "Izin lokasi ditolak"}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  };

  // Opsi eksplisit: hanya jika admin BENAR-BENAR ingin menyalin koordinat GPS sekarang ke titik cabang
  const handleExplicitSetBranchToMyGps = () => {
    if (!detectedUserGps) return;
    const { lat, lng } = detectedUserGps;

    if (markerRef.current && circleRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      circleRef.current.setLatLng([lat, lng]);
      setCurrentCoords({ lat, lng });
      performReverseGeocode(lat, lng);
    }
    toast.success(`Titik cabang ${branchName} berhasil disetel ke posisi GPS Anda saat ini.`);
  };

  return (
    <div
      className={`relative rounded-xl overflow-hidden border border-border shadow-md transition-all duration-300 bg-muted ${
        isFullscreen
          ? "fixed inset-3 sm:inset-6 z-50 shadow-2xl ring-4 ring-primary/20 bg-background"
          : "w-full h-80 sm:h-96"
      } ${className}`}
    >
      {/* Kontainer Peta Leaflet */}
      <div
        ref={mapContainerRef}
        className={`w-full h-full z-0 ${readOnly ? "cursor-default" : "cursor-crosshair"}`}
      />

      {/* OVERLAY TOP: Petunjuk & Indikator Status Simpan */}
      <div className="absolute top-2.5 left-2.5 right-2.5 z-10 flex items-center justify-between gap-2 pointer-events-none">
        {/* Banner Petunjuk Interaktif */}
        <div className="pointer-events-auto bg-card/95 backdrop-blur-md px-3 py-1.5 rounded-lg border border-border/80 shadow-md text-xs font-medium flex items-center gap-2 text-foreground">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          {!readOnly ? (
            <>
              <span className="hidden sm:inline">
                💡 <strong>Klik peta</strong> atau <strong>geser pin merah</strong> untuk menentukan titik absen toko.
              </span>
              <span className="sm:hidden">
                💡 Klik/geser pin merah ke toko
              </span>
            </>
          ) : (
            <span>📍 Peta Lokasi Absensi Cabang</span>
          )}
          {lastSavedTime && !readOnly && (
            <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded">
              <CheckCircle2 className="h-3 w-3" /> Tersimpan ({lastSavedTime})
            </span>
          )}
          {isReverseGeocoding && (
            <span className="text-[10px] text-primary flex items-center gap-1 font-semibold ml-1">
              <RefreshCw className="h-3 w-3 animate-spin" /> Mengambil alamat...
            </span>
          )}
        </div>

        {/* Tombol Kontrol Layar Penuh (Fullscreen) */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="h-8 px-2.5 text-xs font-semibold shadow-md bg-card/95 backdrop-blur-md border border-border hover:bg-card cursor-pointer"
            title={isFullscreen ? "Kecilkan Peta" : "Perbesar Peta (Fullscreen)"}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5 mr-1 text-primary" /> Kecilkan
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5 mr-1 text-primary" /> Perbesar
              </>
            )}
          </Button>
        </div>
      </div>

      {/* OVERLAY TOP-RIGHT: Pemilih Layer Peta (Street / Satellite / Google Hybrid) */}
      <div className="absolute top-12 sm:top-12 right-2.5 z-10 pointer-events-auto flex flex-col gap-1.5">
        <div className="bg-card/95 backdrop-blur-md p-1 rounded-lg border border-border/80 shadow-md flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => handleLayerChange("hybrid")}
            className={`px-2 py-1 rounded-md font-semibold text-[11px] transition-all flex items-center gap-1 cursor-pointer ${
              activeLayer === "hybrid"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="Satelit dengan nama jalan & gedung akurat (Google)"
          >
            🛰️ Hybrid
          </button>
          <button
            type="button"
            onClick={() => handleLayerChange("satellite")}
            className={`px-2 py-1 rounded-md font-semibold text-[11px] transition-all flex items-center gap-1 cursor-pointer ${
              activeLayer === "satellite"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="Citra satelit asli (Esri)"
          >
            📷 Satelit
          </button>
          <button
            type="button"
            onClick={() => handleLayerChange("streets")}
            className={`px-2 py-1 rounded-md font-semibold text-[11px] transition-all flex items-center gap-1 cursor-pointer ${
              activeLayer === "streets"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="Peta jalan standar OpenStreetMap"
          >
            🗺️ Jalan
          </button>
        </div>
      </div>

      {/* OVERLAY RIGHT-BOTTOM: Tombol Kontrol Navigasi (Zoom, Recenter, Cek GPS) */}
      <div className="absolute bottom-12 sm:bottom-10 right-2.5 z-10 pointer-events-auto flex flex-col gap-1.5">
        {/* Tombol Deteksi Posisi Saya Saat Ini */}
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={handleCheckMyGpsLocation}
          disabled={isLocatingUser}
          className="h-8 w-8 rounded-lg shadow-md bg-card/95 backdrop-blur-md border border-border hover:bg-card cursor-pointer"
          title="Tampilkan Posisi GPS Saya Saat Ini di Peta (Tanpa merubah titik toko)"
        >
          <Navigation
            className={`h-4 w-4 text-blue-600 dark:text-blue-400 ${isLocatingUser ? "animate-spin" : ""}`}
          />
        </Button>

        {/* Tombol Pusatkan ke Titik Cabang Toko */}
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={handleRecenter}
          className="h-8 w-8 rounded-lg shadow-md bg-card/95 backdrop-blur-md border border-border hover:bg-card cursor-pointer"
          title="Pusatkan Peta ke Titik Toko"
        >
          <Crosshair className="h-4 w-4 text-red-500" />
        </Button>

        {/* Tombol Zoom In */}
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => mapInstanceRef.current?.zoomIn()}
          className="h-8 w-8 rounded-lg shadow-md bg-card/95 backdrop-blur-md border border-border hover:bg-card font-bold text-sm cursor-pointer"
          title="Perbesar Zoom (+)"
        >
          +
        </Button>

        {/* Tombol Zoom Out */}
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => mapInstanceRef.current?.zoomOut()}
          className="h-8 w-8 rounded-lg shadow-md bg-card/95 backdrop-blur-md border border-border hover:bg-card font-bold text-sm cursor-pointer"
          title="Perkecil Zoom (-)"
        >
          -
        </Button>
      </div>

      {/* OVERLAY BOTTOM: Bar Status Titik & Radius Real-Time */}
      <div className="absolute bottom-2 left-2.5 right-14 sm:right-auto sm:max-w-md z-10 pointer-events-auto">
        <div className="bg-card/95 backdrop-blur-md px-3 py-2 rounded-lg border border-border/80 shadow-md text-xs flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-bold text-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-red-500" />
              Titik Toko: {branchName}
            </span>
            <span className="text-[11px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
              Radius Toleransi: {radiusMeters || 100}m
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
            <span>Lat: {currentCoords.lat.toFixed(6)}</span>
            <span>•</span>
            <span>Lng: {currentCoords.lng.toFixed(6)}</span>
          </div>
          {address && (
            <div className="text-[10px] text-muted-foreground truncate max-w-xs sm:max-w-sm">
              📍 {address}
            </div>
          )}

          {/* Jika mendeteksi GPS perangkat, tampilkan info jarak & tombol opsional */}
          {detectedUserGps && !readOnly && (
            <div className="mt-1 pt-1 border-t border-border flex items-center justify-between gap-1 flex-wrap text-[10px]">
              <span className="text-blue-600 dark:text-blue-400 font-medium">
                Jarak Anda ke toko: <strong>{detectedUserGps.distanceToBranch}m</strong>
              </span>
              <button
                type="button"
                onClick={handleExplicitSetBranchToMyGps}
                className="text-[10px] text-primary hover:underline font-bold cursor-pointer"
              >
                Gunakan Posisi Saya Sebagai Titik Toko
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
