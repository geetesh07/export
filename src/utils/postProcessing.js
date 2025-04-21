import { Vector3 } from 'three';

// More balanced filtering parameters
const POINT_TOLERANCE = 0.0001;
const MIN_LINE_LENGTH = 0.03;  // Reduced to preserve more structural lines
const MAX_PARALLEL_DISTANCE = 0.01;
const MIN_CONNECTED_LINES = 2;  // Back to original value
const MIN_COMPONENT_SIZE = 3;  // Reduced to preserve small but important features
const MAX_DENSITY_THRESHOLD = 12;
const DENSITY_CELL_SIZE = 0.05;
const C1_ANGLE_THRESHOLD = 0.15;  // About 8.6 degrees for C1 continuity check

class LineSegment {
    constructor(start, end) {
        this.start = start;
        this.end = end;
        this.length = start.distanceTo(end);
        this.direction = new Vector3().subVectors(end, start).normalize();
        this.isValid = true;
        this.connections = new Set();
        this.componentId = -1;
        this.hasC1Continuity = false;  // Track if line has C1 continuous connections
    }

    getDistanceTo(point) {
        const v = new Vector3().subVectors(this.end, this.start);
        const w = new Vector3().subVectors(point, this.start);
        const c1 = w.dot(v);
        if (c1 <= 0) return point.distanceTo(this.start);
        const c2 = v.dot(v);
        if (c2 <= c1) return point.distanceTo(this.end);
        return point.distanceTo(this.start.clone().add(v.multiplyScalar(c1/c2)));
    }

    // Check if line is roughly horizontal or vertical
    isAxisAligned() {
        const AXIS_THRESHOLD = 0.1;
        return (Math.abs(this.direction.x) > (1 - AXIS_THRESHOLD) ||
                Math.abs(this.direction.y) > (1 - AXIS_THRESHOLD) ||
                Math.abs(this.direction.z) > (1 - AXIS_THRESHOLD));
    }

    // Check C1 continuity with another line
    hasC1ContinuityWith(other) {
        // Get the connection point
        const startDist = Math.min(
            this.getDistanceTo(other.start),
            this.getDistanceTo(other.end)
        );
        const endDist = Math.min(
            other.getDistanceTo(this.start),
            other.getDistanceTo(this.end)
        );

        // Determine which ends are connected
        let thisDir = this.direction;
        let otherDir = other.direction;

        // If lines are connected at their ends, one direction needs to be reversed
        if ((startDist < POINT_TOLERANCE && this.start.distanceTo(other.end) < POINT_TOLERANCE) ||
            (endDist < POINT_TOLERANCE && this.end.distanceTo(other.start) < POINT_TOLERANCE)) {
            otherDir = otherDir.clone().multiplyScalar(-1);
        }

        // Check angle between directions
        const angle = Math.abs(thisDir.dot(otherDir));
        return angle > (1 - C1_ANGLE_THRESHOLD);
    }
}

class SpatialGrid {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }

    getGridKey(point) {
        const x = Math.floor(point.x / this.cellSize);
        const y = Math.floor(point.y / this.cellSize);
        const z = Math.floor(point.z / this.cellSize);
        return `${x},${y},${z}`;
    }

    addLine(line) {
        const startKey = this.getGridKey(line.start);
        const endKey = this.getGridKey(line.end);
        
        if (!this.grid.has(startKey)) this.grid.set(startKey, []);
        if (!this.grid.has(endKey)) this.grid.set(endKey, []);
        
        this.grid.get(startKey).push(line);
        if (startKey !== endKey) {
            this.grid.get(endKey).push(line);
        }
    }

    getNearbyLines(point) {
        const key = this.getGridKey(point);
        const nearby = [];
        
        // Get lines from current cell and adjacent cells
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const x = Math.floor(point.x / this.cellSize) + dx;
                    const y = Math.floor(point.y / this.cellSize) + dy;
                    const z = Math.floor(point.z / this.cellSize) + dz;
                    const adjacentKey = `${x},${y},${z}`;
                    if (this.grid.has(adjacentKey)) {
                        nearby.push(...this.grid.get(adjacentKey));
                    }
                }
            }
        }
        
        return nearby;
    }
}

function findConnectedComponents(lines) {
    let currentComponent = 0;
    const components = new Map();

    function dfs(line) {
        if (line.componentId !== -1) return;
        line.componentId = currentComponent;
        
        if (!components.has(currentComponent)) {
            components.set(currentComponent, new Set());
        }
        components.get(currentComponent).add(line);

        for (const connected of line.connections) {
            if (connected.componentId === -1) {
                dfs(connected);
            }
        }
    }

    for (const line of lines) {
        if (line.componentId === -1) {
            dfs(line);
            currentComponent++;
        }
    }

    return components;
}

function buildTopology(positions) {
    const lines = [];
    const grid = new SpatialGrid(MAX_PARALLEL_DISTANCE * 2);

    // Create line segments
    for (let i = 0; i < positions.length; i += 6) {
        const start = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
        const end = new Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
        const line = new LineSegment(start, end);
        lines.push(line);
        grid.addLine(line);
    }

    // Build connectivity and check C1 continuity
    for (const line of lines) {
        const nearbyLines = grid.getNearbyLines(line.start);
        nearbyLines.push(...grid.getNearbyLines(line.end));
        
        for (const nearby of new Set(nearbyLines)) {
            if (nearby === line) continue;
            
            const startDist = Math.min(
                line.getDistanceTo(nearby.start),
                line.getDistanceTo(nearby.end)
            );
            const endDist = Math.min(
                nearby.getDistanceTo(line.start),
                nearby.getDistanceTo(line.end)
            );
            
            if (startDist < POINT_TOLERANCE || endDist < POINT_TOLERANCE) {
                line.connections.add(nearby);
                nearby.connections.add(line);

                // Check C1 continuity
                if (line.hasC1ContinuityWith(nearby)) {
                    line.hasC1Continuity = true;
                    nearby.hasC1Continuity = true;
                }
            }
        }
    }

    return lines;
}

function filterLines(lines) {
    // First pass: Remove short and non-continuous lines
    lines = lines.filter(line => {
        // Always keep axis-aligned lines above minimum length
        if (line.isAxisAligned()) {
            return line.length >= MIN_LINE_LENGTH * 0.5;
        }

        // For non-axis-aligned lines, check length, connections, and continuity
        const hasGoodConnections = line.connections.size >= MIN_CONNECTED_LINES;
        const isLongEnough = line.length >= MIN_LINE_LENGTH;
        
        // Keep lines that are either:
        // 1. Long enough and well-connected, or
        // 2. Have C1 continuity with their neighbors
        return (isLongEnough && hasGoodConnections) || line.hasC1Continuity;
    });

    // Second pass: Remove small isolated components
    const components = findConnectedComponents(lines);
    const validComponents = new Set();
    
    for (const [componentId, componentLines] of components) {
        // Check if component has C1 continuous lines or axis-aligned lines
        const hasC1Lines = Array.from(componentLines).some(line => line.hasC1Continuity);
        const hasAxisAlignedLines = Array.from(componentLines).some(line => line.isAxisAligned());
        
        // Keep components that meet any of these criteria:
        // 1. Large enough
        // 2. Contains C1 continuous lines
        // 3. Contains axis-aligned lines
        if (componentLines.size >= MIN_COMPONENT_SIZE || hasC1Lines || hasAxisAlignedLines) {
            validComponents.add(componentId);
        }
    }

    lines = lines.filter(line => validComponents.has(line.componentId));

    // Third pass: Smart density-based filtering
    const densityMap = new Map();
    for (const line of lines) {
        const midpoint = new Vector3().addVectors(line.start, line.end).multiplyScalar(0.5);
        const key = `${Math.floor(midpoint.x/DENSITY_CELL_SIZE)},${Math.floor(midpoint.y/DENSITY_CELL_SIZE)},${Math.floor(midpoint.z/DENSITY_CELL_SIZE)}`;
        densityMap.set(key, (densityMap.get(key) || 0) + 1);
    }

    return lines.filter(line => {
        const midpoint = new Vector3().addVectors(line.start, line.end).multiplyScalar(0.5);
        const key = `${Math.floor(midpoint.x/DENSITY_CELL_SIZE)},${Math.floor(midpoint.y/DENSITY_CELL_SIZE)},${Math.floor(midpoint.z/DENSITY_CELL_SIZE)}`;
        const density = densityMap.get(key) || 0;

        // Always keep:
        // 1. Axis-aligned lines
        // 2. Lines with C1 continuity
        // 3. Lines in low-density areas
        // 4. Long lines
        return line.isAxisAligned() || 
               line.hasC1Continuity ||
               density < MAX_DENSITY_THRESHOLD || 
               line.length > MIN_LINE_LENGTH * 2;
    });
}

export function postProcessProjection(positions) {
    const lines = buildTopology(positions);
    const filteredLines = filterLines(lines);
    
    const newPositions = [];
    for (const line of filteredLines) {
        newPositions.push(
            line.start.x, line.start.y, line.start.z,
            line.end.x, line.end.y, line.end.z
        );
    }
    
    return new Float32Array(newPositions);
}

export function getFilteringStats(originalPositions, filteredPositions) {
    const originalLineCount = originalPositions.length / 6;
    const filteredLineCount = filteredPositions.length / 6;
    
    return {
        originalLineCount,
        filteredLineCount,
        removedLineCount: originalLineCount - filteredLineCount,
        removalPercentage: ((originalLineCount - filteredLineCount) / originalLineCount * 100).toFixed(2)
    };
} 