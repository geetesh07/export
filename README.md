# 3D Model Edge Projection Tool

A web-based tool for creating 2D projections from 3D models with edge detection and DXF export capabilities.

## Features

- Load 3D models (supports GLB and STL formats)
- Generate edge projections along X, Y, or Z axes
- Real-time edge filtering and smoothing
- Export to DXF format with proper dimensions
- Interactive 3D viewer with camera controls
- Post-processing options for edge cleanup

## Setup

1. Clone the repository:
```bash
git clone [repository-url]
cd [repository-name]
```

2. Start a local server (using Python):
```bash
python -m http.server 8080
```

3. Open in your browser:
```
http://localhost:8080
```

## Usage

1. Load a 3D model using the "Choose File" button
2. Adjust projection settings in the GUI panels
3. Use camera controls to view the model
4. Export the projection to DXF using the export controls

## Dependencies

- Three.js for 3D rendering
- DXF Writer for DXF export
- Standard web technologies (HTML5, JavaScript)

## License

MIT License
