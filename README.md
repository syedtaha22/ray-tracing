# Ray Tracing

One of the first scenes (and probably the simplest) that I created in Blender was a submerged cube, somewhere at sea, around sunset. The core focus was volumetric lighting. I can say it turned out pretty well.

![Target render - underwater cube with god rays at sunset](images/godrays.webp)

Now, the goal of this project is simple: recreate that scene from scratch. No Blender. No abstractions. 

Here's all the stuff I'd like to explore:
- Global illumination via Monte Carlo path tracing
- Physically-based material models (metallic, water, matte)
- Volumetric light scattering for atmospheric god rays
- Edge-aware denoising to reduce noise while preserving details
- Interactive controls to adjust lighting in real-time

## Setup

Clone the repository and open `index.html` in your browser to see the ray tracer in action.