(function(){
  const params=new URLSearchParams(window.location.search);
  const optimizerPort=params.get('optPort')||'8787';
  const optimizerOrigin='http://127.0.0.1:'+optimizerPort;

  window.STCT_CONFIG={
    version:'1.4-trust-closure-mission-control',
    productPositioning:'配送路线规划与分析工具',
    dataFilePath:'./data/routes-data-synthetic-v14.js',
    mapStyleUrl:'https://tiles.openfreemap.org/styles/liberty',
    mapStyles:{
      liberty:'https://tiles.openfreemap.org/styles/liberty',
      positron:'https://tiles.openfreemap.org/styles/positron',
      dark:'https://tiles.openfreemap.org/styles/dark',
      bright:'https://tiles.openfreemap.org/styles/bright'
    },
    optimizerApiUrl:optimizerOrigin+'/optimize',
    optimizerHealthUrl:optimizerOrigin+'/health',
    facilityOptimizerApiUrl:optimizerOrigin+'/facility-optimize-v19',
    // Production candidate: never silently accept a different or missing build pin.
    optimizerBuildPolicy:'STRICT_PINNED',
    expectedOptimizerBuildFingerprint:'224442d2cec1278f5cab728855c422b06d8f7a7ec3f4f34d0ee3e23097cdc6c6',
    roadProfile:'driving',
    // Local reuse policy, not a guarantee of road or traffic freshness.
    roadReuseMaxAgeMs:30*24*60*60*1000,
    localRoadEndpoint:'http://127.0.0.1:5001',
    roadRequestTimeoutMs:10000,
    roadBudgetMs:120000,
    roadMaxSnapMeters:1000,
    // Update with the local OSRM extract ID whenever its OSM network data changes.
    roadNetworkVersion:'china-260928-arterial-ferry-mld',
    allowPublicRoutingPreview:false,
    coordinateDisclosureAccepted:false,
    forceHeuristic:['1','true','yes'].includes(String(params.get('forceHeuristic')||'').toLowerCase()),
    roadDistanceFactor:1.35,
    averageSpeedKmh:28,
    defaultServiceMinutes:5,
    maxOptimizerOrders:500,
    maxSolveSeconds:45,
    enableMockLogin:true,
    enableUpload:true,
    enableExport:true,
    costModel:{
      currency:'CNY',
      baseFare:120,
      fixedVehicleCost:120,
      perKm:4.8,
      perMinute:0.35,
      perStop:8
    },
    carbonModel:{
      kgPerKm:0.192,
      defaultVehicleFactor:0.192
    },
    balancedWeights:{
      usedVehicles:20,
      estimatedRoadKm:20,
      totalCost:20,
      totalCO2:15,
      latestEnd:15,
      utilizationScore:10
    },
    lowUtilizationThreshold:35,
    warehouseCoverageKm:40
  };
})();
