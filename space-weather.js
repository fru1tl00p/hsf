document.addEventListener('DOMContentLoaded', function() {
    // Set up refresh button
    document.getElementById('refresh-button').addEventListener('click', fetchSpaceWeatherData);
    
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
    // Show loading indicator
    const loadingIndicator = document.getElementById('loading-indicator');
    loadingIndicator.style.display = 'inline';
    
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
        document.getElementById('last-update').textContent = 'Failed to load data: ' + error.message;
    } finally {
        // Hide loading indicator
        loadingIndicator.style.display = 'none';
    }
}

function processData(magData, plasmaData) {
    // Ensure we have data
    if (magData.length < 2 || plasmaData.length < 2) {
        console.error('Insufficient data received');
        document.getElementById('last-update').textContent = 'Insufficient data received from SWPC API';
        return;
    }
    
    // Get column indices from headers (first array in the JSON)
    const magHeaders = magData[0];
    const plasmaHeaders = plasmaData[0];
    
    // Find indices of the parameters we need
    const btIndex = magHeaders.indexOf('bt');
    const bzIndex = magHeaders.indexOf('bz_gsm');
    const timeIndex = magHeaders.indexOf('time_tag');
    
    const speedIndex = plasmaHeaders.indexOf('speed');
    const densityIndex = plasmaHeaders.indexOf('density');
    
    // Check if we found all necessary indices
    if (btIndex === -1 || bzIndex === -1 || timeIndex === -1) {
        console.error('Could not find required magnetic field parameters in data');
        document.getElementById('last-update').textContent = 'Error: Missing magnetic field parameters in data';
        return;
    }
    
    if (speedIndex === -1 || densityIndex === -1) {
        console.error('Could not find required plasma parameters in data');
        document.getElementById('last-update').textContent = 'Error: Missing plasma parameters in data';
        return;
    }
    
    // Extract data for calculations (skip header row)
    const magDataValues = magData.slice(1);
    const plasmaDataValues = plasmaData.slice(1);
    
    // Filter out rows with missing data
    const validMagData = magDataValues.filter(row => 
        row.length > Math.max(btIndex, bzIndex, timeIndex) && 
        !isNaN(parseFloat(row[btIndex])) && 
        !isNaN(parseFloat(row[bzIndex]))
    );
    
    const validPlasmaData = plasmaDataValues.filter(row => 
        row.length > Math.max(speedIndex, densityIndex) && 
        !isNaN(parseFloat(row[speedIndex])) && 
        !isNaN(parseFloat(row[densityIndex]))
    );
    
    if (validMagData.length === 0 || validPlasmaData.length === 0) {
        console.error('No valid data points found');
        document.getElementById('last-update').textContent = 'Error: No valid data points found';
        return;
    }
    
    // Current values (most recent data points)
    const latestMag = validMagData[validMagData.length - 1];
    const latestPlasma = validPlasmaData[validPlasmaData.length - 1];
    
    const currentBt = parseFloat(latestMag[btIndex]);
    const currentBz = parseFloat(latestMag[bzIndex]);
    const currentSpeed = parseFloat(latestPlasma[speedIndex]);
    // Extract density with special handling for very small values
    const densityValue = parseFloat(latestPlasma[densityIndex]);
    const currentDensity = isNaN(densityValue) ? 0 : densityValue;
    const lastUpdateTime = latestMag[timeIndex];
    
    // Calculate statistics for Bt
    const btValues = validMagData
        .map(row => parseFloat(row[btIndex]))
        .filter(val => !isNaN(val));
    
    const btStats = calculateStats(btValues);
    
    // Calculate statistics for Bz
    const bzValues = validMagData
        .map(row => parseFloat(row[bzIndex]))
        .filter(val => !isNaN(val));
    
    const bzStats = calculateStats(bzValues);
    const bzSouthPercent = (bzValues.filter(val => val < 0).length / bzValues.length * 100).toFixed(1);
    
    // Calculate statistics for solar wind
    const speedValues = validPlasmaData
        .map(row => parseFloat(row[speedIndex]))
        .filter(val => !isNaN(val));
    
    const speedStats = calculateStats(speedValues);
    
    const densityValues = validPlasmaData
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
    if (values.length === 0) return { avg: 0, min: 0, max: 0, std: 0 };
    
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
    // Display density with 2 decimal places for small values
    const densityDisplay = processedData.current.density < 0.1 ? 
        `${processedData.current.density.toFixed(2)} p/cm³` : 
        `${processedData.current.density.toFixed(1)} p/cm³`;
    document.getElementById('density-current').textContent = densityDisplay;
    
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
    // Only proceed if we have data
    if (!processedData.current.time) {
        alert('Please load data first before copying.');
        return;
    }
    
    const text = 
`Space Weather Summary (${processedData.current.time}):
- Bt: ${processedData.current.bt.toFixed(1)} nT (6h avg: ${processedData.stats.bt.avg.toFixed(1)} nT)
- Bz: ${processedData.current.bz.toFixed(1)} nT (${processedData.stats.bzSouthPercent}% southward last 6h)
- Solar Wind: ${processedData.current.speed.toFixed(0)} km/s (6h avg: ${processedData.stats.speed.avg.toFixed(0)} km/s)
- Proton Density: ${processedData.current.density.toFixed(1)} p/cm³`;

    copyToClipboard(text, 'copy-summary');
}

function copyDetailedStats() {
    // Only proceed if we have data
    if (!processedData.current.time) {
        alert('Please load data first before copying.');
        return;
    }
    
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
