document.addEventListener('DOMContentLoaded', function() {
    // Fetch initial data
    fetchSpaceWeatherData();
    
    // Refresh data every 10 minutes
    setInterval(fetchSpaceWeatherData, 10 * 60 * 1000);
    
    // Set up copy buttons
    document.getElementById('copy-summary').addEventListener('click', copySummary);
    document.getElementById('copy-detailed').addEventListener('click', copyDetailedStats);
});

// Global variables to store processed data for copy functions
let processedData = {
    current: {},
    stats: {}
};

async function fetchSpaceWeatherData() {
    try {
        // SWPC API endpoints for 6-hour data
        const magUrl = 'https://services.swpc.noaa.gov/products/solar-wind/mag-6-hour.json';
        const plasmaUrl = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-6-hour.json';
        
        // Fetch magnetic field data
        const magResponse = await fetch(magUrl);
        const magData = await magResponse.json();
        
        // Fetch plasma data
        const plasmaResponse = await fetch(plasmaUrl);
        const plasmaData = await plasmaResponse.json();
        
        // Process and display the data
        processData(magData, plasmaData);
        
    } catch (error) {
        console.error('Error fetching space weather data:', error);
        document.getElementById('bt-current').textContent = 'Error loading data';
        document.getElementById('bz-current').textContent = 'Error loading data';
        document.getElementById('speed-current').textContent = 'Error loading data';
        document.getElementById('density-current').textContent = 'Error loading data';
    }
}

function processData(magData, plasmaData) {
    // Ensure we have data
    if (magData.length < 2 || plasmaData.length < 2) {
        console.error('Insufficient data received');
        return;
    }
    
    // Get column indices from headers
    const magHeaders = magData[0];
    const plasmaHeaders = plasmaData[0];
    
    const btIndex = magHeaders.indexOf('bt');
    const bzIndex = magHeaders.indexOf('bz_gsm');
    const timeIndex = magHeaders.indexOf('time_tag');
    
    const speedIndex = plasmaHeaders.indexOf('speed');
    const densityIndex = plasmaHeaders.indexOf('density');
    
    // Extract data for calculations
    const magDataValues = magData.slice(1); // Skip header row
    const plasmaDataValues = plasmaData.slice(1); // Skip header row
    
    // Current values (most recent data points)
    const latestMag = magDataValues[magDataValues.length - 1];
    const latestPlasma = plasmaDataValues[plasmaDataValues.length - 1];
    
    const currentBt = parseFloat(latestMag[btIndex]);
    const currentBz = parseFloat(latestMag[bzIndex]);
    const currentSpeed = parseFloat(latestPlasma[speedIndex]);
    const currentDensity = parseFloat(latestPlasma[densityIndex]);
    const lastUpdateTime = latestMag[timeIndex];
    
    // Calculate statistics for Bt
    const btValues = magDataValues
        .map(row => parseFloat(row[btIndex]))
        .filter(val => !isNaN(val));
    
    const btStats = calculateStats(btValues);
    
    // Calculate statistics for Bz
    const bzValues = magDataValues
        .map(row => parseFloat(row[bzIndex]))
        .filter(val => !isNaN(val));
    
    const bzStats = calculateStats(bzValues);
    const bzSouthPercent = (bzValues.filter(val => val < 0).length / bzValues.length * 100).toFixed(1);
    
    // Calculate statistics for solar wind
    const speedValues = plasmaDataValues
        .map(row => parseFloat(row[speedIndex]))
        .filter(val => !isNaN(val));
    
    const speedStats = calculateStats(speedValues);
    
    const densityValues = plasmaDataValues
        .map(row => parseFloat(row[densityIndex]))
        .filter(val => !isNaN(val));
    
    const densityStats = calculateStats(densityValues);
    
    // Store processed data for copy functions
    processedData.current = {
        bt: currentBt,
        bz: currentBz,
        speed: currentSpeed,
        density: currentDensity,
        time: lastUpdateTime
    };
    
    processedData.stats = {
        bt: btStats,
        bz: bzStats,
        bzSouthPercent: bzSouthPercent,
        speed: speedStats,
        density: densityStats
    };
    
    // Update the UI
    updateUI();
}

function calculateStats(values) {
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    // Calculate standard deviation
    const squareDiffs = values.map(value => {
        const diff = value - avg;
        return diff * diff;
    });
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
    const std = Math.sqrt(avgSquareDiff);
    
    return {
        avg: avg,
        min: min,
        max: max,
        std: std
    };
}

function updateUI() {
    // Update current values
    document.getElementById('bt-current').textContent = `${processedData.current.bt.toFixed(1)} nT`;
    
    const bzElement = document.getElementById('bz-current');
    bzElement.textContent = `${processedData.current.bz.toFixed(1)} nT`;
    
    // Apply color coding to Bz based on heliobiological significance
    if (processedData.current.bz <= -5) {
        bzElement.style.color = 'red'; // Strong southward
    } else if (processedData.current.bz < 0) {
        bzElement.style.color = 'orange'; // Moderate southward
    } else if (processedData.current.bz >= 5) {
        bzElement.style.color = 'green'; // Strong northward
    } else {
        bzElement.style.color = 'black'; // Neutral or weak
    }
    
    document.getElementById('speed-current').textContent = `${processedData.current.speed.toFixed(0)} km/s`;
    document.getElementById('density-current').textContent = `${processedData.current.density.toFixed(1)} p/cm³`;
    
    // Update statistics
    document.getElementById('bt-avg').textContent = `${processedData.stats.bt.avg.toFixed(1)} nT`;
    document.getElementById('bt-min').textContent = `${processedData.stats.bt.min.toFixed(1)} nT`;
    document.getElementById('bt-max').textContent = `${processedData.stats.bt.max.toFixed(1)} nT`;
    document.getElementById('bt-std').textContent = `${processedData.stats.bt.std.toFixed(1)} nT`;
    
    document.getElementById('bz-avg').textContent = `${processedData.stats.bz.avg.toFixed(1)} nT`;
    document.getElementById('bz-min').textContent = `${processedData.stats.bz.min.toFixed(1)} nT`;
    document.getElementById('bz-max').textContent = `${processedData.stats.bz.max.toFixed(1)} nT`;
    document.getElementById('bz-south-pct').textContent = `${processedData.stats.bzSouthPercent}%`;
    
    document.getElementById('speed-avg').textContent = `${processedData.stats.speed.avg.toFixed(0)} km/s`;
    document.getElementById('speed-max').textContent = `${processedData.stats.speed.max.toFixed(0)} km/s`;
    document.getElementById('density-avg').textContent = `${processedData.stats.density.avg.toFixed(1)} p/cm³`;
    document.getElementById('density-max').textContent = `${processedData.stats.density.max.toFixed(1)} p/cm³`;
    
    // Update last updated time
    const now = new Date();
    document.getElementById('last-update').textContent = 
        `Last updated: ${now.toLocaleString()} (data timestamp: ${processedData.current.time})`;
}

function copySummary() {
    const text = 
`Space Weather Summary (${processedData.current.time}):
- Bt: ${processedData.current.bt.toFixed(1)} nT (6h avg: ${processedData.stats.bt.avg.toFixed(1)} nT)
- Bz: ${processedData.current.bz.toFixed(1)} nT (${processedData.stats.bzSouthPercent}% southward last 6h)
- Solar Wind: ${processedData.current.speed.toFixed(0)} km/s (6h avg: ${processedData.stats.speed.avg.toFixed(0)} km/s)
- Proton Density: ${processedData.current.density.toFixed(1)} p/cm³`;

    copyToClipboard(text, 'copy-summary');
}

function copyDetailedStats() {
    const text = 
`Detailed Space Weather Statistics (${processedData.current.time}):

MAGNETIC FIELD:
- Bt (current): ${processedData.current.bt.toFixed(1)} nT
- Bt 6-hour: avg ${processedData.stats.bt.avg.toFixed(1)} nT, range ${processedData.stats.bt.min.toFixed(1)}-${processedData.stats.bt.max.toFixed(1)} nT, σ ${processedData.stats.bt.std.toFixed(1)} nT

- Bz (current): ${processedData.current.bz.toFixed(1)} nT
- Bz 6-hour: avg ${processedData.stats.bz.avg.toFixed(1)} nT, range ${processedData.stats.bz.min.toFixed(1)}-${processedData.stats.bz.max.toFixed(1)} nT
- Southward orientation: ${processedData.stats.bzSouthPercent}% of last 6 hours

SOLAR WIND:
- Speed (current): ${processedData.current.speed.toFixed(0)} km/s
- Speed 6-hour: avg ${processedData.stats.speed.avg.toFixed(0)} km/s, max ${processedData.stats.speed.max.toFixed(0)} km/s

- Density (current): ${processedData.current.density.toFixed(1)} p/cm³
- Density 6-hour: avg ${processedData.stats.density.avg.toFixed(1)} p/cm³, max ${processedData.stats.density.max.toFixed(1)} p/cm³`;

    copyToClipboard(text, 'copy-detailed');
}

function copyToClipboard(text, buttonId) {
    navigator.clipboard.writeText(text)
        .then(() => {
            const button = document.getElementById(buttonId);
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        })
        .catch(err => {
            console.error('Failed to copy: ', err);
            alert('Could not copy to clipboard. Please try again or copy manually.');
        });
}
