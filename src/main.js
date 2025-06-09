import * as THREE from "three";
// Post-processing utilities
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
// Loader for GLTF models
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

class StereoInterlacer {
  /**
   * @param {THREE.Scene} scene  - the main Three.js scene
   * @param {THREE.WebGLRenderer} renderer - renderer instance
   */
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;

    // Create two perspective cameras (left + right eye)
    this.leftCamera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.rightCamera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Small horizontal offset for stereoscopic parallax
    this.leftCamera.position.set(-0.03, 10, 30);
    this.rightCamera.position.set(0.03, 10, 30);

    // Group them so we can rotate/translate as one unit
    this.cameraGroup = new THREE.Group();
    this.cameraGroup.add(this.leftCamera);
    this.cameraGroup.add(this.rightCamera);
    this.scene.add(this.cameraGroup);

    // Track pitch/yaw for mouse drag
    this.pitch = 0;
    this.yaw = 0;

    // By default, horizontal interlace. Toggle to vertical if needed.
    this.isHorizontal = true;

    // Create “placeholder” render targets (we'll resize properly in handleResize)
    this.leftRenderTarget = new THREE.WebGLRenderTarget(1, 1);
    this.rightRenderTarget = new THREE.WebGLRenderTarget(1, 1);

    // Set up post-processing composer
    this.composer = new EffectComposer(this.renderer);

    // Custom shader: pick one texture or the other based on floor(vUv × resolution) % 2
    this.cameraTintShader = {
      uniforms: {
        leftTexture: { value: null },
        rightTexture: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        isHorizontal: { value: this.isHorizontal },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D leftTexture;
        uniform sampler2D rightTexture;
        uniform bool    isHorizontal;
        uniform vec2    resolution; // actual drawing-buffer size
        varying vec2    vUv;

        void main() {
          // Compute exact scanline (row or column) in the drawing buffer
          float index = isHorizontal
            ? floor(vUv.y * resolution.y)   // which row
            : floor(vUv.x * resolution.x);  // which column

          bool isEven = mod(index, 2.0) < 1.0;
          vec4 color = isEven
            ? texture2D(leftTexture,  vUv)
            : texture2D(rightTexture, vUv);

          gl_FragColor = color;
        }
      `,
    };

    // Create the ShaderPass and render it to screen
    this.tintPass = new ShaderPass(this.cameraTintShader);
    this.tintPass.renderToScreen = true;
    this.composer.addPass(this.tintPass);

    // Do an initial resize to set up everything correctly…
    this.handleResize();
    // …and re-run on every window resize (including Chrome zoom)
    window.addEventListener("resize", this.handleResize.bind(this));
  }

  /**
   * Flip between horizontal <-> vertical interlace
   */
  toggleInterlaceDirection() {
    this.isHorizontal = !this.isHorizontal;
    this.tintPass.uniforms.isHorizontal.value = this.isHorizontal;
  }

  /**
   * Rotate camera group based on mouse-drag
   * @param {number} dx  - delta x (pixels)
   * @param {number} dy  - delta y (pixels)
   */
  updateCameraRotation(dx, dy) {
    this.yaw -= dx * 0.002;
    this.pitch -= dy * 0.002;
    this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
    this.cameraGroup.rotation.set(this.pitch, this.yaw, 0);
  }

  /**
   * Render each eye to its render target, then composite with the interlace shader
   */
  render() {
    // Render left eye → leftRenderTarget
    this.renderer.setRenderTarget(this.leftRenderTarget);
    this.renderer.render(this.scene, this.leftCamera);

    // Render right eye → rightRenderTarget
    this.renderer.setRenderTarget(this.rightRenderTarget);
    this.renderer.render(this.scene, this.rightCamera);

    // Back to default framebuffer (screen)
    this.renderer.setRenderTarget(null);

    // Update the shader uniforms to point at the latest textures
    this.tintPass.uniforms.leftTexture.value = this.leftRenderTarget.texture;
    this.tintPass.uniforms.rightTexture.value = this.rightRenderTarget.texture;

    // Finally, draw the full-screen quad with our interlace fragment shader
    this.composer.render();
  }

  /**
   * Called whenever window size (or zoom) changes.
   * Recalculates devicePixelRatio, real drawing size, and updates cameras, targets, composer, and uniforms.
   */
  handleResize() {
    // 1) Update the renderer’s pixel ratio to match current window.devicePixelRatio
    //    (Chrome zoom or OS DPI changes will alter window.devicePixelRatio).
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // 2) Recompute “real” width/height in physical pixels
    const pixelRatio = this.renderer.getPixelRatio();
    const realWidth = Math.floor(window.innerWidth * pixelRatio);
    const realHeight = Math.floor(window.innerHeight * pixelRatio);

    // 3) Update camera aspect ratios & projection matrices (CSS-based aspect)
    const aspect = window.innerWidth / window.innerHeight;
    [this.leftCamera, this.rightCamera].forEach((cam) => {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    });

    // 4) Resize the canvas’s CSS size (*not* the drawing buffer):
    //    this affects window.innerWidth/innerHeight
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // 5) Resize the composer’s drawing buffer to (realWidth × realHeight)
    this.composer.setSize(realWidth, realHeight);

    // 6) Dispose and recreate render targets at exactly (realWidth × realHeight)
    this.leftRenderTarget.dispose();
    this.rightRenderTarget.dispose();
    this.leftRenderTarget = new THREE.WebGLRenderTarget(realWidth, realHeight);
    this.rightRenderTarget = new THREE.WebGLRenderTarget(realWidth, realHeight);

    // 7) Update the shader’s resolution uniform to (realWidth, realHeight)
    this.tintPass.uniforms.resolution.value.set(realWidth, realHeight);
  }
}

// ---------- USAGE EXAMPLE (index.js or main.js) ----------

// 1) Create your scene & renderer:
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({
  // antialias: true,    // you can enable if you want smoother edges
});
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// Append canvas to <body>
document.body.appendChild(renderer.domElement);

// 2) Make sure renderer’s initial pixelRatio is correct:
renderer.setPixelRatio(window.devicePixelRatio);

// 3) Instantiate StereoInterlacer
const stereo = new StereoInterlacer(scene, renderer);

// 4) Load a skybox (Milky Way) or any environment
const loader = new THREE.CubeTextureLoader();
const skyboxTexture = loader.load([
  "https://threejs.org/examples/textures/cube/MilkyWay/dark-s_nx.jpg",
  "https://threejs.org/examples/textures/cube/MilkyWay/dark-s_ny.jpg",
  "https://threejs.org/examples/textures/cube/MilkyWay/dark-s_nz.jpg",
  "https://threejs.org/examples/textures/cube/MilkyWay/dark-s_px.jpg",
  "https://threejs.org/examples/textures/cube/MilkyWay/dark-s_py.jpg",
  "https://threejs.org/examples/textures/cube/MilkyWay/dark-s_pz.jpg",
]);
scene.background = skyboxTexture;

// 5) Add lights
const ambientLight = new THREE.AmbientLight(0xffffff, 2);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 10);
sunLight.position.set(5, 10, 7.5);
sunLight.castShadow = true;
scene.add(sunLight);

// 6) Load a GLB model (e.g. the ISS)
const gltfLoader = new GLTFLoader();
gltfLoader.load(
  "/models/ISS_stationary.glb",
  (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.position.set(0, 0, 0);
  },
  undefined,
  (error) => {
    console.error("Error loading GLB model:", error);
  }
);

// 7) UI button to flip between horizontal/vertical interlace
const button = document.createElement("button");
button.innerText = "Toggle Interlace Mode";
button.style.position = "absolute";
button.style.top = "10px";
button.style.left = "10px";
button.style.zIndex = 1000;
document.body.appendChild(button);
button.addEventListener("click", () => stereo.toggleInterlaceDirection());

// 8) Keyboard & mouse controls for camera movement
const keys = {};
window.addEventListener("keydown", (e) => (keys[e.code] = true));
window.addEventListener("keyup", (e) => (keys[e.code] = false));

let isMouseDown = false;
let lastX = 0;
let lastY = 0;

renderer.domElement.addEventListener("mousedown", (e) => {
  isMouseDown = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
renderer.domElement.addEventListener("mouseup", () => {
  isMouseDown = false;
});
renderer.domElement.addEventListener("mousemove", (e) => {
  if (isMouseDown) {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    stereo.updateCameraRotation(dx, dy);
    lastX = e.clientX;
    lastY = e.clientY;
  }
});

// WASD/Space/Shift/Q/E movement
function updateCameraControls() {
  const speed = 0.05;
  const rotationSpeed = 0.02;
  const dir = new THREE.Vector3();

  if (keys["KeyW"]) dir.z -= speed;
  if (keys["KeyW"] && keys["KeyF"]) dir.z -= speed * 5;
  if (keys["KeyS"]) dir.z += speed;
  if (keys["KeyS"] && keys["KeyF"]) dir.z += speed * 5;
  if (keys["KeyA"]) dir.x -= speed;
  if (keys["KeyA"] && keys["KeyF"]) dir.x -= speed * 5;
  if (keys["KeyD"]) dir.x += speed;
  if (keys["KeyD"] && keys["KeyF"]) dir.x += speed * 5;
  if (keys["Space"]) dir.y += speed;
  if (keys["Space"] && keys["KeyF"]) dir.y += speed * 5;
  if (keys["ShiftLeft"] || keys["ShiftRight"]) dir.y -= speed;
  if (
    (keys["ShiftLeft"] && keys["KeyF"]) ||
    (keys["ShiftRight"] && keys["KeyF"])
  )
    dir.y -= speed * 4;

  if (keys["KeyQ"]) stereo.cameraGroup.rotateZ(rotationSpeed);
  if (keys["KeyE"]) stereo.cameraGroup.rotateZ(-rotationSpeed);

  stereo.cameraGroup.translateX(dir.x);
  stereo.cameraGroup.translateY(dir.y);
  stereo.cameraGroup.translateZ(dir.z);
}

// 9) Animation loop
function animate() {
  requestAnimationFrame(animate);
  updateCameraControls();
  stereo.render();
}
animate();
