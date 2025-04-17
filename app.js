// tiny helpers --------------------------------------------------------------
const R  = 6371e3;                         // Earth radius (m)
const toRad = d => d * Math.PI / 180;

function boundingBox(lat, lon, r=500){
  const dLat = (r/R) * 180/Math.PI;
  const dLon = dLat / Math.cos(toRad(lat));
  return {latMin:lat-dLat, latMax:lat+dLat, lonMin:lon-dLon, lonMax:lon+dLon};
}

function haversine(lat1,lon1,lat2,lon2){
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

// main ----------------------------------------------------------------------
async function run(){
  const geojson = await fetch("stores.geojson").then(r=>r.json());

  navigator.geolocation.getCurrentPosition(({coords})=>{
    const {latitude:lat, longitude:lon} = coords;

    // map -------------------------------------------------------------------
    const map = new maplibregl.Map({
  container: "map",
  style: {
    "version": 8,
    "sources": {
      "osm": {
        "type": "raster",
        "tiles": [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
        ],
        "tileSize": 256,
        "attribution": "© OpenStreetMap contributors"
      }
    },
    "layers": [
      { "id": "osm", "type": "raster", "source": "osm" }
    ]
  },
  center: [lon, lat],
  zoom: 15
});
    new maplibregl.Marker({color:"#385"})
      .setLngLat([lon,lat])
      .setPopup(new maplibregl.Popup().setText("You are here"))
      .addTo(map);

    // filter + render -------------------------------------------------------
    const {latMin,latMax,lonMin,lonMax} = boundingBox(lat,lon);
    const hits = geojson.features
      .filter(f=>{
        const [lng,lt] = f.geometry.coordinates;
        return lt>latMin && lt<latMax && lng>lonMin && lng<lonMax &&
               haversine(lat,lon,lt,lng)<=10000
      });

    for(const f of hits){
      // list
      const card = document.createElement("div");
      card.className="card";
      card.innerHTML = `<strong>${f.properties.name}</strong><br>
                        ${f.properties.headline}<br>
                        <small>ends ${f.properties.ends}</small>`;
      document.getElementById("list").append(card);

      // marker
      new maplibregl.Marker()
        .setLngLat(f.geometry.coordinates)
        .setPopup(new maplibregl.Popup({offset:25})
          .setHTML(`<strong>${f.properties.name}</strong><br>${f.properties.headline}`))
        .addTo(map);
    }
  }, ()=>alert("Can’t get your location 😢"));
}
run();
