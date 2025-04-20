# Edge Projection System

This package contains the core components needed to implement the edge projection functionality in your own Three.js projects.

## Overview

The edge projection system allows you to project the edges of a 3D model onto a 2D plane (XY, XZ, or YZ) for visualization purposes. This is particularly useful for technical drawings, engineering applications, or any scenario where you need to see a 2D representation of 3D objects.

## Files Structure

- **src/ProjectionGenerator.js**: The main class that handles the edge projection logic
- **src/utils/**: Utility functions for edge detection, intersection handling, etc.
- **src/worker/**: Worker implementations for better performance with large models
- **index.html**: A simple example showing how to use the system

## Dependencies

- Three.js (version 0.136.0 or compatible)
- three-mesh-bvh (version 0.5.19 or compatible)

## Basic Usage

Here's how to use the edge projection system in your own project:

```javascript
import { ProjectionGenerator } from './src/ProjectionGenerator.js';
import { generateEdges } from './src/utils/generateEdges.js';

// 1. Create a Three.js mesh with geometry
const geometry = yourThreeJSGeometry;
const mesh = new THREE.Mesh(geometry, material);

// 2. Clone and prepare the geometry for projection
const processedGeometry = geometry.clone();
processedGeometry.applyMatrix4(mesh.matrixWorld);

// 3. Create the projection generator
const generator = new ProjectionGenerator();
generator.sortEdges = true;
generator.includeIntersectionEdges = true;
generator.angleThreshold = 50; // Threshold for detecting edges

// 4. Set the projection direction (X, Y, or Z axis)
const projectionVector = new THREE.Vector3(0, 0, 1); // Z-axis (project onto XY plane)
generator.projectionVector = projectionVector;

// 5. Generate the projection (async with generator pattern)
const task = generator.generate(processedGeometry, {
  onProgress: (progress, data) => {
    // Update UI with progress
    // Optionally display intermediate results
    if (data) {
      projectionMesh.geometry = data.getLineGeometry(0, 'Z');
    }
  }
});

// 6. Process the generator task
async function processProjection() {
  let result = task.next();
  while (!result.done) {
    // Do other things if needed
    await new Promise(resolve => setTimeout(resolve, 0));
    result = task.next();
  }
  
  // 7. Get the final projected edges
  const finalGeometry = result.value;
  projectionMesh.geometry = finalGeometry.getLineGeometry(0, 'Z');
}

// 8. Display the projection
const projectionMesh = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({
    color: 0xffffff,
    linewidth: 2,
    opacity: 0.9,
    transparent: true
  })
);
scene.add(projectionMesh);
```

## Configuration Options

The `ProjectionGenerator` class accepts several options:

- **sortEdges**: Whether to sort edges for better rendering (default: true)
- **includeIntersectionEdges**: Whether to include edges from intersecting triangles (default: true)
- **angleThreshold**: Angle threshold for detecting edges (default: 50 degrees)
- **projectionVector**: Direction to project along (default: Y-axis)

## API Reference

### ProjectionGenerator

The main class for generating edge projections.

```javascript
const generator = new ProjectionGenerator();
```

#### Properties

- **sortEdges**: Boolean - Whether to sort edges
- **includeIntersectionEdges**: Boolean - Whether to include intersection edges
- **angleThreshold**: Number - Threshold angle for edge detection
- **projectionVector**: Vector3 - Direction vector for projection

#### Methods

- **generate(geometry, options)**: Generator function that produces the projection
- **generateAsync(geometry, options)**: Promise-based version of generate

### Utilities

- **generateEdges(geometry, normal, threshold)**: Generates edges from a geometry
- **trimToBeneathTriPlane(tri, line, lineTarget, projectionVector)**: Clips lines against triangle planes
- **getProjectedLineOverlap(line, triangle, lineTarget, projectionVector)**: Calculates line-triangle overlaps

## Example

See the included `index.html` for a complete working example. 