# 3D Edge Projection Visualization

This project demonstrates real-time 3D edge projection and visualization techniques using Three.js. It allows viewing models with projected edges onto any of the three primary planes (XY, XZ, YZ).

## Features

- Load and visualize 3D models (GLB format)
- Project model edges onto XY, XZ, or YZ planes
- Interactive camera controls
- Customizable edge appearance (color, thickness, opacity)
- Model scaling and rotation controls
- Real-time edge recalculation when changing parameters

## Getting Started

### Prerequisites

- A modern web browser
- A local web server (Python's built-in server, Node.js, or any other HTTP server)

### Running the Application

1. Clone this repository
2. Start a local web server in the project directory:
   ```
   python -m http.server 8080
   ```
3. Open your browser and navigate to `http://localhost:8080/new-edgeProjection.html`

## Usage

- **Camera Controls**: Click and drag to rotate, scroll to zoom, right-click and drag to pan
- **Upload Models**: Use the "Upload Custom Model" panel to load your own .glb files
- **Display Settings**: Toggle model display, edge projection, and other options in the left panel
- **Change Projection Axis**: Select X, Y, or Z axis to change the projection plane
- **Edge Appearance**: Customize edge color, thickness, and opacity

## Technical Implementation

The core of this application uses:
- Three.js for 3D rendering
- three-mesh-bvh for acceleration structures
- Custom edge projection algorithms that work with any arbitrary projection direction

## Structure

- `edgeProjection.js`: Main application code
- `src/ProjectionGenerator.js`: Core projection generation algorithm
- `src/utils/`: Utility functions for edge processing
- `src/worker/`: Asynchronous worker implementations for better performance

## License

MIT 