import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, onSnapshot, addDoc, serverTimestamp, query, orderBy, limit, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- CONFIGURATION ---
// 1. Replace with your Firebase Config (from Console > Project Settings > General > Web App)
// const firebaseConfig = {
//   // apiKey: "AIzaSy...",
//   // authDomain: "...",
//   // projectId: "...",
//   // ...
// };

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// 2. Gemini API Key is now handled by the backend (api/chat.js)
const apiKey = null;

// --- GLOBAL VARIABLES ---
const container = document.getElementById('canvas-container');
let scene, camera, renderer, fireLight, moonLight;
let fireParticles = [], snowParticles = [], cloudParticles = [];
let avatarMeshes = {};
let companionMeshes = [];

// State
let myUser = null;
let myAvatar = { type: 'human', color: '#1d4ed8' };
let roomId = 'lobby';
let otherPlayers = {};
let fireColorTarget = { r: 1, g: 0.6, b: 0 };
let fireColorCurrent = { r: 1, g: 0.6, b: 0 };
let fireIntensity = 1.0;
let isHolidayMode = false;
let holidayDecorations = [];
let companionType = 'none';
let musicMasterGain = null;
let storySourceNode = null;
let storyTimeouts = [];
let audioContext = null;
let beatInterval = null, melodyInterval = null;
let isMusicPlaying = false;
let beatStep = 0;

// Firebase & Auth Placeholders (Safe Mode)
let app, auth, db;
const appId = 'cozy-nights-v7';

// --- SAFE INITIALIZATION ---
function initServices() {
    try {
        // Only init if config is present
        if (firebaseConfig.apiKey) {
            app = initializeApp(firebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);
            console.log("Firebase initialized successfully.");

            // Auth Listener
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    myUser = user;
                    randomizeAvatar();
                    joinRoom();
                    listenToRoom();
                    listenToChat();
                }
            });

            // Start Auth
            signInAnonymously(auth).catch(e => console.error("Auth Error:", e));
        } else {
            console.warn("⚠️ Firebase Config missing. Multiplayer disabled. (Update script.js)");
        }
    } catch (e) {
        console.error("Firebase Initialization Failed:", e);
    }
}

// --- UI FUNCTIONS (Attached to Window for HTML access) ---

window.toggleChatPanel = function () {
    const panel = document.getElementById('chatPanel');
    panel.classList.toggle('hidden');
}

window.toggleStoryModal = function () {
    const modal = document.getElementById('storyModal');
    modal.classList.toggle('hidden');
}

window.switchTab = function (tab) {
    if (tab === 'friends') {
        document.getElementById('viewFriends').classList.remove('hidden');
        document.getElementById('viewFlame').classList.add('hidden');
        document.getElementById('tabFriends').classList.add('tab-active');
        document.getElementById('tabFriends').classList.remove('tab-inactive');
        document.getElementById('tabFlame').classList.remove('tab-active');
        document.getElementById('tabFlame').classList.add('tab-inactive');
    } else {
        document.getElementById('viewFriends').classList.add('hidden');
        document.getElementById('viewFlame').classList.remove('hidden');
        document.getElementById('tabFriends').classList.remove('tab-active');
        document.getElementById('tabFriends').classList.add('tab-inactive');
        document.getElementById('tabFlame').classList.add('tab-active');
        document.getElementById('tabFlame').classList.remove('tab-inactive');
    }
}

window.changeAvatar = function () {
    const types = ['human', 'mage', 'dog', 'skeleton'];
    const colors = ['#1d4ed8', '#15803d', '#b91c1c', '#a21caf', '#c2410c', '#4338ca'];
    myAvatar.type = types[Math.floor(Math.random() * types.length)];
    myAvatar.color = colors[Math.floor(Math.random() * colors.length)];
    updateMyPlayerDoc();
}

window.toggleHolidayMode = function () {
    isHolidayMode = !isHolidayMode;
    const btn = document.getElementById('holidayBtn');
    if (isHolidayMode) {
        btn.innerText = "🎄 Holiday: ON";
        btn.classList.replace('text-red-100', 'text-green-100');
        btn.classList.replace('bg-red-800', 'bg-green-800');
        btn.classList.replace('hover:bg-red-700', 'hover:bg-green-700');
        btn.classList.replace('border-red-950', 'border-green-950');
    } else {
        btn.innerText = "🎄 Holiday: OFF";
        btn.classList.replace('text-green-100', 'text-red-100');
        btn.classList.replace('bg-green-800', 'bg-red-800');
        btn.classList.replace('hover:bg-green-700', 'hover:bg-red-700');
        btn.classList.replace('border-green-950', 'border-red-950');
    }
    holidayDecorations.forEach(d => d.visible = isHolidayMode);
}

window.cycleCompanion = function () {
    const types = ['none', 'deer', 'fox', 'cow', 'all'];
    let idx = types.indexOf(companionType);
    idx = (idx + 1) % types.length;
    companionType = types[idx];

    // Clear existing
    companionMeshes.forEach(m => scene.remove(m));
    companionMeshes = [];

    if (companionType === 'all') {
        const deer = createAvatarMesh('deer', '#8d6e63');
        deer.position.set(3.5, 0, 0); deer.lookAt(0, 0, 0);
        scene.add(deer); companionMeshes.push(deer);

        const fox = createAvatarMesh('fox', '#8d6e63');
        fox.position.set(-3.5, 0, 0); fox.lookAt(0, 0, 0);
        scene.add(fox); companionMeshes.push(fox);

        const cow = createAvatarMesh('cow', '#8d6e63');
        cow.position.set(0, 0, -3.5); cow.lookAt(0, 0, 0);
        scene.add(cow); companionMeshes.push(cow);
    } else if (companionType !== 'none') {
        const m = createAvatarMesh(companionType, '#8d6e63');
        m.position.set(3.5, 0, 0); m.lookAt(0, 0, 0);
        scene.add(m);
        companionMeshes.push(m);
    }
}

window.copyInviteLink = function () {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        const fb = document.getElementById('copyFeedback');
        fb.innerText = "Link Copied! Share with friends.";
        fb.classList.remove('hidden');
        setTimeout(() => fb.classList.add('hidden'), 3000);
    });
}

// --- 3D ENGINE ---

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function init3D() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050a15, 0.015);
    scene.background = new THREE.Color(0x050a15);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 12);

    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x404060, 0.8);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.4);
    scene.add(hemi);

    fireLight = new THREE.PointLight(0xff6600, 2, 30);
    fireLight.position.set(0, 2, 0);
    fireLight.castShadow = true;
    fireLight.shadow.bias = -0.0001;
    scene.add(fireLight);

    moonLight = new THREE.DirectionalLight(0xaaccff, 0.4);
    moonLight.position.set(0, 20, -50);
    moonLight.castShadow = true;
    scene.add(moonLight);

    buildEnvironment();
    buildForest();
    buildSky();
    buildCampfireBase();

    for (let i = 0; i < 150; i++) {
        const p = new FireParticle();
        p.life = Math.random();
        fireParticles.push(p);
    }

    for (let i = 0; i < 400; i++) {
        const s = new SnowParticle();
        snowParticles.push(s);
    }

    window.addEventListener('resize', onWindowResize, false);
    setupCameraControls();

    animate();
}

// ... (Reuse buildEnvironment, buildForest, buildSky, buildCampfireBase from previous version) ...
// For brevity, assume standard ThreeJS setup functions are here (same as previous code)
function buildEnvironment() {
    const geo = new THREE.PlaneGeometry(100, 100);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const bladeGeo = new THREE.BufferGeometry();
    const vertices = new Float32Array([-0.1, 0, 0.1, 0, 0.8, 0, 0, 0, 0, 0.1, 0, 0.1, 0, 0.8, 0, 0, 0, 0]);
    bladeGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    bladeGeo.computeVertexNormals();
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, side: THREE.DoubleSide });
    const instancedGrass = new THREE.InstancedMesh(bladeGeo, bladeMat, 4000);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 4000; i++) {
        const r = 3 + Math.random() * 40;
        const theta = Math.random() * Math.PI * 2;
        const scaleY = 0.5 + Math.random() * 1.0;
        dummy.scale.set(1, scaleY, 1);
        dummy.position.set(r * Math.sin(theta), 0, r * Math.cos(theta));
        dummy.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5);
        dummy.updateMatrix();
        instancedGrass.setMatrixAt(i, dummy.matrix);
    }
    instancedGrass.receiveShadow = true;
    scene.add(instancedGrass);
}

function buildForest() {
    const treeCount = 25;
    for (let i = 0; i < treeCount; i++) {
        const angle = (i / treeCount) * Math.PI * 2 + (Math.random() * 0.5);
        const r = 18 + Math.random() * 10;
        createVoxelTree(Math.sin(angle) * r, Math.cos(angle) * r);
    }
}

function createVoxelTree(x, z) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshStandardMaterial({ color: 0x3e2723 }));
    trunk.position.y = 2; trunk.castShadow = true; group.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1b5e20 });
    [{ w: 4, y: 3 }, { w: 3, y: 4 }, { w: 2, y: 5 }, { w: 1, y: 6 }].forEach(layer => {
        const l = new THREE.Mesh(new THREE.BoxGeometry(layer.w, 1, layer.w), leafMat);
        l.position.y = layer.y; l.castShadow = true; group.add(l);
        for (let i = 0; i < 4; i++) {
            if (Math.random() > 0.3) {
                const c = [0xff0000, 0x00ff00, 0x0088ff, 0xffaa00][Math.floor(Math.random() * 4)];
                const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: c }));
                const angle = (i / 4) * Math.PI * 2 + Math.random();
                const offset = layer.w / 2 + 0.1;
                bulb.position.set(Math.sin(angle) * offset, layer.y, Math.cos(angle) * offset);
                bulb.visible = false; holidayDecorations.push(bulb); group.add(bulb);
            }
        }
    });
    const star = new THREE.Group();
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.1), new THREE.MeshBasicMaterial({ color: 0xffd700 }));
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.1), new THREE.MeshBasicMaterial({ color: 0xffd700 }));
    h.rotation.z = Math.PI / 2; star.add(v); star.add(h); star.position.y = 7; star.visible = false; holidayDecorations.push(star); group.add(star);
    group.position.set(x, 0, z); const s = 1 + Math.random() * 0.5; group.scale.set(s, s, s); scene.add(group);
}

function buildSky() {
    const moonGroup = new THREE.Group();
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xffeebb });
    moonGroup.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), moonMat));
    const craterMat = new THREE.MeshBasicMaterial({ color: 0xeecd99 });
    for (let i = 0; i < 8; i++) {
        const s = 1 + Math.random() * 2;
        const crater = new THREE.Mesh(new THREE.BoxGeometry(s, 0.5, s), craterMat);
        crater.position.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 6.1);
        crater.rotation.x = Math.PI / 2; moonGroup.add(crater);
    }
    moonGroup.position.set(0, 25, -60); moonGroup.lookAt(0, 0, 0); scene.add(moonGroup);

    for (let i = 0; i < 15; i++) {
        const cGroup = new THREE.Group();
        const cMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.7 });
        const chunks = 5 + Math.random() * 5;
        for (let j = 0; j < chunks; j++) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 5), cMat);
            m.position.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8); cGroup.add(m);
        }
        cGroup.position.set((Math.random() - 0.5) * 120, 14 + Math.random() * 6, -30 + (Math.random() - 0.5) * 80);
        scene.add(cGroup); cloudParticles.push(cGroup);
    }

    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    for (let i = 0; i < 5000; i++) {
        vertices.push(THREE.MathUtils.randFloatSpread(300)); vertices.push(Math.random() * 150 + 20); vertices.push(THREE.MathUtils.randFloatSpread(300));
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, transparent: true, opacity: 0.8 })));
}

function buildCampfireBase() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4e342e });
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 2.5), mat); l1.position.set(1.2, 0.3, 0); l1.rotation.y = 0.5; scene.add(l1);
    const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 2.5), mat); l2.position.set(-1.2, 0.3, 0); l2.rotation.y = -0.5; scene.add(l2);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    for (let i = 0; i < 8; i++) {
        const stone = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), stoneMat);
        const angle = (i / 8) * Math.PI * 2;
        stone.position.set(Math.sin(angle) * 1.5, 0.2, Math.cos(angle) * 1.5);
        scene.add(stone);
    }
}

class FireParticle {
    constructor() {
        this.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
        this.life = 0; this.reset(); scene.add(this.mesh);
    }
    reset() {
        const theta = Math.random() * Math.PI * 2; const r = Math.random() * 0.5;
        this.mesh.position.set(r * Math.sin(theta), 0.2 + Math.random() * 0.3, r * Math.cos(theta));
        this.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.02, 0.06 + Math.random() * 0.04, (Math.random() - 0.5) * 0.02);
        this.life = 1.0; this.phase = Math.random() * Math.PI * 2;
        this.mesh.scale.set(1, 1, 1); this.mesh.visible = true;
    }
    update(time, intensity, colorCurrent) {
        this.mesh.position.add(this.velocity);
        this.mesh.position.y += this.velocity.y * (intensity - 1.0) * 0.5;
        this.mesh.position.x += Math.sin(time * 4 + this.phase) * 0.015;
        this.mesh.rotation.x += 0.1; this.mesh.rotation.y += 0.1;
        this.life -= 0.015;
        const s = Math.max(0, this.life);
        this.mesh.scale.set(s, s, s);
        if (this.life > 0.6) {
            this.mesh.material.color.setRGB(1.0 * 0.6 + colorCurrent.r * 0.4, 1.0 * 0.6 + colorCurrent.g * 0.4, 1.0 * 0.6 + colorCurrent.b * 0.4);
        } else if (this.life > 0.2) {
            this.mesh.material.color.setRGB(colorCurrent.r, colorCurrent.g, colorCurrent.b);
        } else { this.mesh.material.color.setHex(0x222222); }
        if (this.life <= 0) this.reset();
    }
}

class SnowParticle {
    constructor() {
        this.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        this.reset(); scene.add(this.mesh);
    }
    reset() {
        this.mesh.position.set((Math.random() - 0.5) * 40, 10 + Math.random() * 20, (Math.random() - 0.5) * 40);
        this.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.05, -0.05 - Math.random() * 0.05, (Math.random() - 0.5) * 0.05);
        this.mesh.visible = isHolidayMode;
    }
    update() {
        if (!isHolidayMode) { this.mesh.visible = false; return; }
        this.mesh.visible = true;
        this.mesh.position.add(this.velocity);
        if (this.mesh.position.y < 0) this.reset();
    }
}

function setupCameraControls() {
    let isDragging = false;
    let pm = { x: 0, y: 0 };
    let radius = 12; let theta = 0; let phi = Math.PI / 2.5;
    function updateCamera() {
        phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, phi));
        camera.position.x = radius * Math.sin(phi) * Math.sin(theta);
        camera.position.y = radius * Math.cos(phi);
        camera.position.z = radius * Math.sin(phi) * Math.cos(theta);
        camera.lookAt(0, 1.5, 0);
    }
    container.addEventListener('mousedown', (e) => isDragging = true);
    container.addEventListener('mouseup', (e) => isDragging = false);
    container.addEventListener('mouseleave', (e) => isDragging = false);
    container.addEventListener('mousemove', (e) => {
        if (isDragging) { theta -= (e.offsetX - pm.x) * 0.005; phi -= (e.offsetY - pm.y) * 0.005; updateCamera(); }
        pm = { x: e.offsetX, y: e.offsetY };
    });
    container.addEventListener('wheel', (e) => {
        radius += e.deltaY * 0.01; radius = Math.max(2, Math.min(40, radius)); updateCamera();
    });
    updateCamera();
}

function createAvatarMesh(type, colorHex) {
    const group = new THREE.Group();
    const headGroup = new THREE.Group();
    const color = new THREE.Color(colorHex);
    const skin = new THREE.Color(0xffccaa);
    const matBody = new THREE.MeshStandardMaterial({ color: color });
    const matSkin = new THREE.MeshStandardMaterial({ color: skin });
    const matBone = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const matWood = new THREE.MeshStandardMaterial({ color: 0x8d6e63 });
    const matGem = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 0.5 });
    const matOrange = new THREE.MeshStandardMaterial({ color: 0xff6600 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const matCow = new THREE.MeshStandardMaterial({ color: 0xd4a373 });
    const matSpot = new THREE.MeshStandardMaterial({ color: 0x3e2723 });

    const box = (w, h, d, mat, x, y, z, parent = group) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
    };

    const isCompanion = (type === 'deer' || type === 'fox' || type === 'cow');
    if (isCompanion) group.scale.set(1.3, 1.3, 1.3);

    if (type === 'skeleton') {
        box(0.6, 0.7, 0.4, matBone, 0, 0.65, 0);
        box(0.2, 0.3, 0.2, matBone, 0, -0.4, 0, headGroup);
        box(0.7, 0.7, 0.7, matBone, 0, 0.1, 0, headGroup);
        box(0.15, 0.15, 0.05, matDark, 0.15, 0.1, 0.36, headGroup);
        box(0.15, 0.15, 0.05, matDark, -0.15, 0.1, 0.36, headGroup);
        headGroup.position.y = 1.5; group.add(headGroup);
        box(0.2, 0.6, 0.2, matBone, -0.2, 0.3, 0.4).rotation.x = -Math.PI / 2;
        box(0.2, 0.6, 0.2, matBone, 0.2, 0.3, 0.4).rotation.x = -Math.PI / 2;
    } else if (type === 'dog') {
        box(0.6, 0.5, 1.0, matBody, 0, 0.25, 0);
        box(0.5, 0.5, 0.6, matBody, 0, 0, 0, headGroup);
        box(0.15, 0.15, 0.05, matDark, 0.15, 0.1, 0.31, headGroup);
        box(0.15, 0.15, 0.05, matDark, -0.15, 0.1, 0.31, headGroup);
        box(0.2, 0.2, 0.2, matDark, 0, -0.1, 0.31, headGroup);
        headGroup.position.set(0, 0.75, 0.4); group.add(headGroup);
        const tail = box(0.2, 0.2, 0.5, matBody, 0, 0.5, -0.7);
        tail.rotation.x = 0.5; group.userData.isDog = true; group.userData.tail = tail;
    } else if (type === 'mage') {
        box(0.8, 1.0, 0.6, matBody, 0, 0.5, 0);
        box(0.6, 0.6, 0.6, matSkin, 0, 0, 0, headGroup);
        const hat = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 8), matBody);
        hat.position.set(0, 0.9, 0); headGroup.add(hat);
        box(1.2, 0.1, 1.2, matBody, 0, 0.35, 0, headGroup);
        headGroup.position.y = 1.3; group.add(headGroup);
        const staffGroup = new THREE.Group();
        box(0.1, 2.0, 0.1, matWood, 0, 0, 0, staffGroup);
        box(0.2, 0.2, 0.2, matGem, 0, 1.0, 0, staffGroup);
        staffGroup.position.set(0.6, 1.0, 0.4); staffGroup.rotation.z = -0.2; group.add(staffGroup);
        box(0.2, 0.6, 0.2, matBody, -0.3, 0, 0.4).rotation.x = -Math.PI / 2;
        box(0.2, 0.6, 0.2, matBody, 0.3, 0, 0.4).rotation.x = -Math.PI / 2;
    } else if (type === 'deer') {
        box(0.6, 0.6, 1.0, matWood, 0, 0.3, 0);
        box(0.4, 0.4, 0.5, matWood, 0, 0, 0, headGroup);
        box(0.1, 0.1, 0.1, matDark, 0, -0.1, 0.26, headGroup);
        // Eyes
        box(0.08, 0.08, 0.05, matDark, 0.12, 0.15, 0.26, headGroup);
        box(0.08, 0.08, 0.05, matDark, -0.12, 0.15, 0.26, headGroup);
        const antler = (xDir) => {
            const a = new THREE.Group();
            box(0.05, 0.6, 0.05, matBone, 0, 0.3, 0, a);
            box(0.04, 0.3, 0.04, matBone, xDir * 0.1, 0.4, 0, a).rotation.z = -xDir * 0.5;
            box(0.04, 0.2, 0.04, matBone, -xDir * 0.1, 0.2, 0.1, a).rotation.x = 0.5;
            return a;
        };
        const lAnt = antler(1); lAnt.position.set(0.15, 0.2, 0); headGroup.add(lAnt);
        const rAnt = antler(-1); rAnt.position.set(-0.15, 0.2, 0); headGroup.add(rAnt);
        headGroup.position.set(0, 0.9, 0.4); group.add(headGroup);
        box(0.15, 0.5, 0.15, matWood, -0.2, 0, 0.3).rotation.x = -Math.PI / 6;
        box(0.15, 0.5, 0.15, matWood, 0.2, 0, 0.3).rotation.x = -Math.PI / 6;
    } else if (type === 'fox') {
        box(0.5, 0.4, 0.9, matOrange, 0, 0.2, 0);
        box(0.4, 0.4, 0.5, matOrange, 0, 0, 0, headGroup);
        box(0.2, 0.15, 0.2, matWhite, 0, -0.15, 0.3, headGroup);
        box(0.1, 0.1, 0.1, matDark, 0, -0.1, 0.4, headGroup);
        // Eyes
        box(0.08, 0.08, 0.05, matDark, 0.1, 0.1, 0.26, headGroup);
        box(0.08, 0.08, 0.05, matDark, -0.1, 0.1, 0.26, headGroup);
        headGroup.position.set(0, 0.6, 0.4); group.add(headGroup);
        const tailGroup = new THREE.Group();
        box(0.5, 0.5, 0.7, matOrange, 0, 0, 0, tailGroup);
        box(0.3, 0.3, 0.4, matWhite, 0, 0, -0.6, tailGroup);
        tailGroup.position.set(0, 0.4, -0.8);
        tailGroup.rotation.x = 0.3;
        group.userData.tail = tailGroup;
        group.add(tailGroup);
        group.userData.isDog = true;
    } else if (type === 'cow') {
        box(0.8, 0.7, 1.2, matCow, 0, 0.35, 0);
        box(0.4, 0.4, 0.4, matSpot, 0.1, 0.4, 0.2);
        box(0.3, 0.3, 0.3, matSpot, -0.2, 0.5, -0.3);
        box(0.6, 0.6, 0.7, matCow, 0, 0, 0, headGroup);
        box(0.1, 0.1, 0.05, matDark, 0.2, 0.1, 0.36, headGroup);
        box(0.1, 0.1, 0.05, matDark, -0.2, 0.1, 0.36, headGroup);
        box(0.1, 0.2, 0.1, matBone, 0.25, 0.3, 0, headGroup);
        box(0.1, 0.2, 0.1, matBone, -0.25, 0.3, 0, headGroup);
        headGroup.position.set(0, 0.9, 0.5); group.add(headGroup);
        box(0.2, 0.5, 0.2, matCow, -0.3, 0, 0.4).rotation.x = -Math.PI / 2;
        box(0.2, 0.5, 0.2, matCow, 0.3, 0, 0.4).rotation.x = -Math.PI / 2;
    } else {
        box(0.8, 0.8, 0.4, matBody, 0, 0.7, 0);
        box(0.6, 0.6, 0.6, matSkin, 0, 0, 0, headGroup);
        headGroup.position.y = 1.4; group.add(headGroup);
        box(0.25, 0.6, 0.25, matDark, -0.2, 0.2, 0.3).rotation.x = -Math.PI / 2;
        box(0.25, 0.6, 0.25, matDark, 0.2, 0.2, 0.3).rotation.x = -Math.PI / 2;
    }

    group.userData.head = headGroup;
    group.userData.nextLookTime = Math.random() * 5;
    group.userData.lookTarget = 0;
    return group;
}

function animate() {
    requestAnimationFrame(animate);
    const time = Date.now() * 0.001;

    fireColorCurrent.r += (fireColorTarget.r - fireColorCurrent.r) * 0.05;
    fireColorCurrent.g += (fireColorTarget.g - fireColorCurrent.g) * 0.05;
    fireColorCurrent.b += (fireColorTarget.b - fireColorCurrent.b) * 0.05;
    fireLight.color.setRGB(fireColorCurrent.r, fireColorCurrent.g, fireColorCurrent.b);
    fireLight.intensity = 1.5 + Math.sin(time * 10) * 0.5 * fireIntensity;

    fireParticles.forEach(p => p.update(time, fireIntensity, fireColorCurrent));
    snowParticles.forEach(p => p.update());
    cloudParticles.forEach(c => c.position.x += 0.01);

    Object.values(avatarMeshes).forEach(mesh => animateAvatar(mesh, time));
    companionMeshes.forEach(mesh => animateAvatar(mesh, time));

    renderer.render(scene, camera);
}

function animateAvatar(mesh, time) {
    mesh.position.y = Math.sin(time * 2 + mesh.id) * 0.02;
    if (mesh.userData.tail) mesh.userData.tail.rotation.y = Math.sin(time * 8) * 0.5;
    if (mesh.userData.head) {
        if (time > mesh.userData.nextLookTime) {
            const r = Math.random();
            if (r < 0.3) mesh.userData.lookTarget = -0.6;
            else if (r < 0.6) mesh.userData.lookTarget = 0.6;
            else mesh.userData.lookTarget = 0;
            mesh.userData.nextLookTime = time + 2 + Math.random() * 4;
        }
        mesh.userData.head.rotation.y += (mesh.userData.lookTarget - mesh.userData.head.rotation.y) * 0.05;
    }
}

function randomizeAvatar() {
    const types = ['human', 'mage', 'dog', 'skeleton'];
    const colors = ['#1d4ed8', '#15803d', '#b91c1c', '#a21caf', '#c2410c', '#4338ca'];
    myAvatar.type = types[Math.floor(Math.random() * types.length)];
    myAvatar.color = colors[Math.floor(Math.random() * colors.length)];
}

async function joinRoom() {
    if (!db || !myUser) return;
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', `rooms/${roomId}/players/${myUser.uid}`);
    const angle = Math.random() * Math.PI * 2;
    await setDoc(userRef, { uid: myUser.uid, type: myAvatar.type, color: myAvatar.color, lastSeen: serverTimestamp(), angle: angle });
    window.addEventListener('beforeunload', () => { deleteDoc(userRef); });
}

async function updateMyPlayerDoc() {
    if (!db || !myUser) return;
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', `rooms/${roomId}/players/${myUser.uid}`);
    await setDoc(userRef, { type: myAvatar.type, color: myAvatar.color }, { merge: true });
}

function listenToRoom() {
    if (!db) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', `rooms/${roomId}/players`);
    onSnapshot(q, (snapshot) => {
        const currentData = {};
        let count = 0;
        snapshot.forEach(doc => {
            const data = doc.data();
            currentData[data.uid] = data;
            count++;
        });
        update3DScene(currentData);
        const badge = document.getElementById('playerCountBadge');
        if (count > 1) { badge.innerText = count; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }
    });
}

function update3DScene(playersData) {
    Object.keys(playersData).forEach(uid => {
        const p = playersData[uid];
        if (!avatarMeshes[uid]) {
            const mesh = createAvatarMesh(p.type, p.color);
            mesh.position.set(Math.sin(p.angle) * 4.5, 0, Math.cos(p.angle) * 4.5);
            mesh.lookAt(0, 0, 0);
            scene.add(mesh);
            avatarMeshes[uid] = mesh;
            avatarMeshes[uid].userData.type = p.type;
            avatarMeshes[uid].userData.color = p.color;
        } else {
            const mesh = avatarMeshes[uid];
            if (mesh.userData.type !== p.type || mesh.userData.color !== p.color) {
                scene.remove(mesh);
                const newMesh = createAvatarMesh(p.type, p.color);
                newMesh.position.copy(mesh.position);
                newMesh.rotation.copy(mesh.rotation);
                scene.add(newMesh);
                avatarMeshes[uid] = newMesh;
                avatarMeshes[uid].userData.type = p.type;
                avatarMeshes[uid].userData.color = p.color;
            }
        }
    });
    Object.keys(avatarMeshes).forEach(uid => {
        if (!playersData[uid]) { scene.remove(avatarMeshes[uid]); delete avatarMeshes[uid]; }
    });
}

function listenToChat() {
    if (!db) return;
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', `rooms/${roomId}/messages`), orderBy('timestamp', 'desc'), limit(20));
    onSnapshot(q, (snapshot) => {
        const history = document.getElementById('multiplayerHistory');
        history.innerHTML = '';
        const msgs = [];
        snapshot.forEach(doc => msgs.push(doc.data()));
        msgs.reverse();
        if (msgs.length === 0) history.innerHTML = '<div class="text-stone-500 font-pixel-body text-center text-sm mt-4">Waiting for friends...</div>';
        msgs.forEach(msg => {
            const div = document.createElement('div');
            div.className = (msg.uid === myUser.uid) ? "bubble-user p-2 max-w-[90%] font-pixel-body text-lg break-words" : "bubble-friend p-2 max-w-[90%] font-pixel-body text-lg break-words";
            let icon = '👤';
            if (msg.avatarType === 'mage') icon = '🧙';
            if (msg.avatarType === 'dog') icon = '🐕';
            if (msg.avatarType === 'skeleton') icon = '💀';
            div.innerText = `${icon} : ${msg.text}`;
            history.appendChild(div);
        });
        history.scrollTop = history.scrollHeight;
    });
}

function getRoomFromUrl() {
    const hash = window.location.hash.substring(1);
    if (hash) return hash;
    const newRoom = 'room-' + Math.random().toString(36).substr(2, 6);
    window.location.hash = newRoom;
    return newRoom;
}
roomId = getRoomFromUrl();

// --- AUDIO ---
function initAudio() { if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)(); }

window.startAudioContextOnFirstInteraction = function () {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log("AudioContext resumed on interaction.");
            if (!isMusicPlaying) window.toggleAmbientMusic();
        });
    } else if (!audioContext) {
        // Optionally init here if desired
    }
}

window.toggleAmbientMusic = function () {
    initAudio();
    if (audioContext.state === 'suspended') audioContext.resume();
    const btn = document.getElementById('musicBtn');
    isMusicPlaying = !isMusicPlaying;

    if (isMusicPlaying) {
        startMusic();
        btn.innerText = "🎵 Beats: ON";
        btn.classList.replace('text-stone-400', 'text-emerald-400');
        if (musicMasterGain) {
            musicMasterGain.gain.cancelScheduledValues(audioContext.currentTime);
            musicMasterGain.gain.setValueAtTime(0, audioContext.currentTime);
            musicMasterGain.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 2);
        }
    } else {
        stopMusic();
        btn.innerText = "🎵 Beats: OFF";
        btn.classList.replace('text-emerald-400', 'text-stone-400');
    }
}

function startMusic() {
    if (!musicMasterGain && audioContext) {
        musicMasterGain = audioContext.createGain();
        musicMasterGain.gain.value = 0.2;
        musicMasterGain.connect(audioContext.destination);
    }
    const sixteenthTime = 176;
    beatInterval = setInterval(() => { playDrumStep(beatStep); beatStep = (beatStep + 1) % 16; }, sixteenthTime);
    melodyInterval = setInterval(playMelody, sixteenthTime * 4);
}
function stopMusic() { clearInterval(beatInterval); clearInterval(melodyInterval); }
function playDrumStep(step) {
    const t = audioContext.currentTime;
    if (step === 0 || step === 10) playKick(t);
    if (step === 4 || step === 12) playSnare(t);
    if (step % 2 === 0) playHat(t, step % 4 === 0 ? 0.05 : 0.02);
}
function playKick(t) { const osc = audioContext.createOscillator(); const gain = audioContext.createGain(); osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.5); gain.gain.setValueAtTime(0.5, t); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5); osc.connect(gain); gain.connect(musicMasterGain); osc.start(t); osc.stop(t + 0.5); }
function playSnare(t) { const n = audioContext.createBuffer(1, audioContext.sampleRate * 0.2, audioContext.sampleRate); const d = n.getChannelData(0); for (let i = 0; i < n.length; i++) d[i] = Math.random() * 2 - 1; const src = audioContext.createBufferSource(); src.buffer = n; const g = audioContext.createGain(); const f = audioContext.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1000; g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.2); src.connect(f); f.connect(g); g.connect(musicMasterGain); src.start(t); }
function playHat(t, v) { const n = audioContext.createBuffer(1, audioContext.sampleRate * 0.05, audioContext.sampleRate); const d = n.getChannelData(0); for (let i = 0; i < n.length; i++) d[i] = Math.random() * 2 - 1; const src = audioContext.createBufferSource(); src.buffer = n; const f = audioContext.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000; const g = audioContext.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.05); src.connect(f); f.connect(g); g.connect(musicMasterGain); src.start(t); }
function playMelody() { const notes = [329.63, 415.30, 493.88, 622.25, 277.18, 369.99]; if (Math.random() > 0.4) playChillNote(notes[Math.floor(Math.random() * notes.length)]); }
function playChillNote(f) { const t = audioContext.currentTime; const osc = audioContext.createOscillator(); const g = audioContext.createGain(); osc.type = 'triangle'; osc.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 2); osc.connect(g); g.connect(musicMasterGain); osc.start(t); osc.stop(t + 2); }

// --- AI ---
window.sendAiMessage = async function () {
    const input = document.getElementById('aiInput'); const txt = input.value; if (!txt) return;
    const hist = document.getElementById('flameHistory'); hist.innerHTML += `<div class="bubble-user p-2 max-w-[90%] font-pixel-body text-lg">${txt}</div>`; input.value = '';
    const loadId = 'ld-' + Date.now(); hist.innerHTML += `<div id="${loadId}" class="bubble-ai p-2 loading-dots font-pixel-body">Thinking</div>`; hist.scrollTop = hist.scrollHeight;
    try {
        const prompt = `You are a magical campfire. User says: "${txt}". Reply shortly. If asked to change fire color, reply with [COLOR: #hexcode] (e.g. [COLOR: #0000ff]). If asked to stoke, [STOKE]. If asked to dim, [DIM].`;
        const res = await fetch(`/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt })
        });
        const data = await res.json();
        let ans = data.candidates?.[0]?.content?.parts?.[0]?.text || "...";

        // Parse Commands
        if (ans.includes('[STOKE]')) { fireIntensity = 1.5; ans = ans.replace('[STOKE]', ''); }
        if (ans.includes('[DIM]')) { fireIntensity = 0.5; ans = ans.replace('[DIM]', ''); }

        const colorMatch = ans.match(/\[COLOR:\s*(#[0-9a-fA-F]{6})\]/);
        if (colorMatch) {
            const hex = colorMatch[1];
            const c = new THREE.Color(hex);
            fireColorTarget = { r: c.r, g: c.g, b: c.b };
            ans = ans.replace(colorMatch[0], '');
        }

        // If answer is empty after stripping commands, provide a default fallback
        if (!ans.trim()) {
            ans = "*The fire crackles and changes color.*";
        }

        document.getElementById(loadId).remove();
        hist.innerHTML += `<div class="bubble-ai p-2 max-w-[90%] font-pixel-body text-lg">${ans}</div>`;
        hist.scrollTop = hist.scrollHeight;
    } catch (e) { console.error(e); document.getElementById(loadId).innerHTML = "Connection error"; }
}

window.generateStory = async function () {
    document.getElementById('storyModal').classList.add('hidden');
    const overlay = document.getElementById('story-overlay');
    const lineEl = document.getElementById('story-line');
    overlay.classList.remove('hidden');
    lineEl.innerText = "Conjuring voice...";
    lineEl.classList.add('story-visible');

    const topic = document.getElementById('storyTopic').value.trim() || "a mysterious but cozy night";
    const prompt = `Write a very short, cozy campfire story about ${topic}. Under 100 words. Divide it into short sentences. No title.`;

    try {
        const txtResponse = await fetch(`/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt })
        });
        const txtData = await txtResponse.json(); const text = txtData.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) throw new Error("No text generated");
        const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
        playStorySequentially(sentences, 0);

    } catch (error) { console.error(error); lineEl.innerText = "Connection lost."; }
}

async function playStorySequentially(sentences, index) {
    if (index >= sentences.length) {
        setTimeout(() => {
            document.getElementById('story-overlay').classList.add('hidden');
            document.getElementById('stopStoryBtn').classList.add('hidden');
        }, 3000);
        return;
    }

    const lineEl = document.getElementById('story-line');
    lineEl.innerText = sentences[index].trim();
    lineEl.classList.add('story-visible');
    document.getElementById('stopStoryBtn').classList.remove('hidden');

    try {
        initAudio();
        const audioResponse = await fetch(`/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: sentences[index] })
        });
        const audioData = await audioResponse.json();
        const audioContent = audioData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (audioContent) {
            await playPCM16Promise(audioContent);
            setTimeout(() => playStorySequentially(sentences, index + 1), 500);
        } else {
            setTimeout(() => playStorySequentially(sentences, index + 1), 2000);
        }
    } catch (e) {
        console.error(e);
        setTimeout(() => playStorySequentially(sentences, index + 1), 2000);
    }
}

function playPCM16Promise(base64Data) {
    return new Promise((resolve) => {
        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        const int16Data = new Int16Array(bytes.buffer);
        const buffer = audioContext.createBuffer(1, int16Data.length, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < int16Data.length; i++) channelData[i] = int16Data[i] / 32768.0;

        storySourceNode = audioContext.createBufferSource();
        storySourceNode.buffer = buffer;
        storySourceNode.connect(audioContext.destination);
        storySourceNode.start();
        storySourceNode.onended = () => resolve();
    });
}

window.stopStory = function () {
    if (storySourceNode) {
        try { storySourceNode.stop(); } catch (e) { }
        storySourceNode = null;
    }
    location.reload();
}

// --- Multiplayer ---
window.sendMultiplayerMessage = async function () {
    if (!db || !myUser) return;
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    const msgsRef = collection(db, 'artifacts', appId, 'public', 'data', `rooms/${roomId}/messages`);
    await addDoc(msgsRef, {
        uid: myUser.uid,
        text: text,
        avatarType: myAvatar.type,
        timestamp: serverTimestamp()
    });
    input.value = '';
}

// Run Init
document.addEventListener('click', window.startAudioContextOnFirstInteraction, { once: true });
document.addEventListener('keydown', window.startAudioContextOnFirstInteraction, { once: true });

initServices();
init3D();