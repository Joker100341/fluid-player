import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/video-plugin/index.css';

let _psvModules = null;

const CARDBOARD_VERT = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const CARDBOARD_FRAG = `
    uniform sampler2D tDiffuse;
    uniform vec2 uK;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
        float isRight = step(0.5, vUv.x);
        float eyeU = (vUv.x - isRight * 0.5) * 2.0;
        vec2 p = vec2(eyeU, vUv.y) * 2.0 - 1.0;
        float r2 = dot(p, p);
        vec2 pDist = p * (1.0 + uK.x * r2 + uK.y * r2 * r2);
        if (abs(pDist.x) > 1.0 || abs(pDist.y) > 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }
        vec2 sampleUv = pDist * 0.5 + 0.5;
        sampleUv.x = sampleUv.x * 0.5 + isRight * 0.5;
        float r = length(p);
        float v = 1.0 - smoothstep(uVignette, 1.0, r);
        gl_FragColor = vec4(texture2D(tDiffuse, sampleUv).rgb * v, 1.0);
    }
`;

function buildCardboardEffect(THREE) {
    const { StereoCamera, Vector2, WebGLRenderTarget, OrthographicCamera, Scene, PlaneGeometry, Mesh, ShaderMaterial } = THREE;

    return class CardboardEffect {
        constructor(renderer) {
            const _stereo = new StereoCamera();
            _stereo.aspect = 0.5;
            // _logSize: CSS/logical pixels — passed to setViewport/setScissor (Three.js
            // multiplies these by pixelRatio before sending to GL).
            // _phySize: physical/drawing-buffer pixels — used to size the WebGLRenderTarget
            // (setRenderTarget copies rt.viewport to GL without any pixelRatio scaling).
            const _logSize = new Vector2();
            const _phySize = new Vector2();
            renderer.getDrawingBufferSize(_phySize);

            const _rt = new WebGLRenderTarget(_phySize.x, _phySize.y);
            const _postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
            const _postScene = new Scene();
            const _mat = new ShaderMaterial({
                uniforms: {
                    tDiffuse: { value: _rt.texture },
                    uK: { value: new Vector2(0.22, 0.08) },
                    uVignette: { value: 0.72 },
                },
                vertexShader: CARDBOARD_VERT,
                fragmentShader: CARDBOARD_FRAG,
                depthTest: false,
                depthWrite: false,
            });
            const _quad = new Mesh(new PlaneGeometry(2, 2), _mat);
            _quad.frustumCulled = false;
            _postScene.add(_quad);

            this.setEyeSeparation = (sep) => { _stereo.eyeSep = sep; };

            this.setSize = (w, h) => {
                renderer.setSize(w, h);
                renderer.getDrawingBufferSize(_phySize);
                _rt.setSize(_phySize.x, _phySize.y);
            };

            this.dispose = () => {
                _rt.dispose();
                _mat.dispose();
                _quad.geometry.dispose();
            };

            this.render = (scene, camera) => {
                if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
                if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
                _stereo.update(camera);

                // Logical (CSS) pixels — Three.js multiplies these by pixelRatio
                // before sending to GL in setViewport/setScissor.
                renderer.getSize(_logSize);
                const lw = _logSize.x, lh = _logSize.y;

                // Physical pixels — setRenderTarget copies rt.viewport to GL
                // directly with NO pixelRatio scaling, so the render target must
                // be sized in actual device pixels.
                renderer.getDrawingBufferSize(_phySize);
                if (_rt.width !== _phySize.x || _rt.height !== _phySize.y) {
                    _rt.setSize(_phySize.x, _phySize.y);
                }

                const prevTarget = renderer.getRenderTarget();
                const prevAutoClear = renderer.autoClear;

                renderer.setRenderTarget(_rt);
                renderer.autoClear = false;
                renderer.clear();
                renderer.setScissorTest(true);
                renderer.setScissor(0, 0, lw / 2, lh);
                renderer.setViewport(0, 0, lw / 2, lh);
                renderer.render(scene, _stereo.cameraL);
                renderer.setScissor(lw / 2, 0, lw / 2, lh);
                renderer.setViewport(lw / 2, 0, lw / 2, lh);
                renderer.render(scene, _stereo.cameraR);
                renderer.setScissorTest(false);

                renderer.setRenderTarget(prevTarget);
                renderer.setViewport(0, 0, lw, lh);
                renderer.autoClear = true;
                renderer.render(_postScene, _postCam);
                renderer.autoClear = prevAutoClear;
            };
        }
    };
}

export default function (playerInstance, options) {
    playerInstance.createCardboardJoystickButton = (identity) => {
        const vrJoystickPanel = playerInstance.domRef.wrapper.querySelector('.fluid_vr_joystick_panel');
        const joystickButton = document.createElement('div');

        joystickButton.className = 'fluid_vr_button fluid_vr_joystick_' + identity;
        vrJoystickPanel.appendChild(joystickButton);

        return joystickButton;
    };

    playerInstance.cardboardRotateLeftRight = (param /* 0 - right, 1 - left */) => {
        const { yaw, pitch } = playerInstance.vrViewer.getPosition();
        const delta = param < 1 ? playerInstance.vrROTATION_POSITION : -playerInstance.vrROTATION_POSITION;
        playerInstance.vrViewer.animate({ yaw: yaw + delta, pitch, speed: playerInstance.vrROTATION_SPEED });
    };

    playerInstance.cardboardRotateUpDown = (param /* 0 - down, 1 - up */) => {
        const { yaw, pitch } = playerInstance.vrViewer.getPosition();
        const delta = param < 1 ? -playerInstance.vrROTATION_POSITION : playerInstance.vrROTATION_POSITION;
        playerInstance.vrViewer.animate({ yaw, pitch: pitch + delta, speed: playerInstance.vrROTATION_SPEED });
    };

    playerInstance.createCardboardJoystick = () => {
        const vrContainer = playerInstance.domRef.wrapper.querySelector('.fluid_vr_container');

        const vrJoystickPanel = document.createElement('div');
        vrJoystickPanel.className = 'fluid_vr_joystick_panel';
        vrContainer.appendChild(vrJoystickPanel);

        const upButton = playerInstance.createCardboardJoystickButton('up');
        const leftButton = playerInstance.createCardboardJoystickButton('left');
        const rightButton = playerInstance.createCardboardJoystickButton('right');
        const downButton = playerInstance.createCardboardJoystickButton('down');
        const zoomDefaultButton = playerInstance.createCardboardJoystickButton('zoomdefault');
        const zoomInButton = playerInstance.createCardboardJoystickButton('zoomin');
        const zoomOutButton = playerInstance.createCardboardJoystickButton('zoomout');

        upButton.addEventListener('click', () => playerInstance.cardboardRotateUpDown(1));
        downButton.addEventListener('click', () => playerInstance.cardboardRotateUpDown(0));
        rightButton.addEventListener('click', () => playerInstance.cardboardRotateLeftRight(0));
        leftButton.addEventListener('click', () => playerInstance.cardboardRotateLeftRight(1));
        zoomDefaultButton.addEventListener('click', () => playerInstance.vrViewer.zoom(50));
        zoomOutButton.addEventListener('click', () => playerInstance.vrViewer.zoomOut(10));
        zoomInButton.addEventListener('click', () => playerInstance.vrViewer.zoomIn(10));
    };

    playerInstance.cardBoardResize = () => {
        playerInstance.domRef.player.removeEventListener('theatreModeOn', handleWindowResize);
        playerInstance.domRef.player.addEventListener('theatreModeOn', handleWindowResize);

        playerInstance.domRef.player.removeEventListener('theatreModeOff', handleWindowResize);
        playerInstance.domRef.player.addEventListener('theatreModeOff', handleWindowResize);

        window.removeEventListener('resize', handleWindowResize);
        window.addEventListener('resize', handleWindowResize);
    };

    function handleWindowResize() {
        playerInstance.vrViewer.autoSize();
    }

    playerInstance.cardBoardSwitchToNormal = () => {
        const vrJoystickPanel = playerInstance.domRef.wrapper.querySelector('.fluid_vr_joystick_panel');
        const videoPlayerTag = playerInstance.domRef.player;
        let controlBars = videoPlayerTag.parentNode.getElementsByClassName('fluid_controls_container');

        // Stop gyroscope and release orientation lock
        const gyroPlugin = playerInstance.vrViewer.getPlugin('gyroscope');
        if (gyroPlugin?.isEnabled()) {
            gyroPlugin.stop();
        }
        try { screen.orientation?.unlock(); } catch (_) {}

        // Restore mouse/touch drag navigation
        playerInstance.vrViewer.setOption('mousemove', true);

        // Dispose barrel-distortion resources and remove the custom renderer.
        playerInstance._vrCardboardEffect?.dispose();
        playerInstance._vrCardboardEffect = null;
        playerInstance.vrViewer.renderer.setCustomRenderer(null);

        const { width, height } = playerInstance.vrViewer.getSize();
        playerInstance.vrViewer.renderer.renderer.setViewport(0, 0, width, height);

        playerInstance.domRef.wrapper.classList.remove('fluid_vr_active');
        playerInstance._vrManualStereo = false;

        playerInstance.vrMode = false;

        const controlBarsArr = Array.from(controlBars);
        const secondControlBarIndex = controlBarsArr.findIndex(control => control.classList.contains('fluid_vr2_controls_container'));

        if (secondControlBarIndex !== -1) {
            const secondControlBar = controlBars[secondControlBarIndex];
            const originalControlBar = controlBarsArr.find((el, i) => i !== secondControlBarIndex);

            videoPlayerTag.parentNode.removeChild(secondControlBar);
            originalControlBar?.classList.remove("fluid_vr_controls_container");
        }

        if (playerInstance.displayOptions.layoutControls.showCardBoardJoystick && vrJoystickPanel) {
            vrJoystickPanel.style.display = "block";
        }

        const volumeContainer = playerInstance.domRef.wrapper.querySelector('.fluid_control_volume_container');
        volumeContainer.style.display = "block";

        const adCountDownTimerText = playerInstance.domRef.wrapper.querySelector('.ad_countdown');
        const ctaButton = playerInstance.domRef.wrapper.querySelector('.fluid_ad_cta');
        const addAdPlayingTextOverlay = playerInstance.domRef.wrapper.querySelector('.fluid_ad_playing');
        const skipBtn = playerInstance.domRef.wrapper.querySelector('.skip_button');

        if (adCountDownTimerText) { adCountDownTimerText.style.display = 'block'; }
        if (ctaButton) { ctaButton.style.display = 'block'; }
        if (addAdPlayingTextOverlay) { addAdPlayingTextOverlay.style.display = 'block'; }
        if (skipBtn) { skipBtn.style.display = 'block'; }
    };

    playerInstance.cardBoardHideDefaultControls = () => {
        const vrJoystickPanel = playerInstance.domRef.wrapper.querySelector('.fluid_vr_joystick_panel');
        const initialPlay = playerInstance.domRef.wrapper.querySelector('.fluid_initial_play');
        const volumeContainer = playerInstance.domRef.wrapper.querySelector('.fluid_control_volume_container');

        if (playerInstance.displayOptions.layoutControls.showCardBoardJoystick && vrJoystickPanel) {
            vrJoystickPanel.style.display = "none";
        }

        if (initialPlay) {
            playerInstance.domRef.wrapper.querySelector('.fluid_initial_play').style.display = "none";
            playerInstance.domRef.wrapper.querySelector('.fluid_initial_play_button_container').style.opacity = "1";
        }

        volumeContainer.style.display = "none";
    };

    playerInstance.cardBoardCreateVRControls = () => {
        const controlBar = playerInstance.domRef.wrapper.querySelector('.fluid_controls_container');

        const newControlBar = controlBar.cloneNode(true);
        newControlBar.removeAttribute('id');
        newControlBar.querySelectorAll('*').forEach(function (node) {
            node.removeAttribute('id');
        });

        newControlBar.classList.add("fluid_vr2_controls_container");
        playerInstance.domRef.player.parentNode.insertBefore(newControlBar, playerInstance.domRef.player.nextSibling);
        playerInstance.copyEvents(newControlBar);
    };

    playerInstance.cardBoardSwitchToVR = () => {
        const controlBar = playerInstance.domRef.wrapper.querySelector('.fluid_controls_container');
        const { CardboardEffect } = _psvModules;
        const isMobile = playerInstance.getMobileOs().userOs === 'Android' || playerInstance.getMobileOs().userOs === 'iOS';

        playerInstance.vrMode = true;
        playerInstance._vrManualStereo = true;

        const adCountDownTimerText = playerInstance.domRef.wrapper.querySelector('.ad_countdown');
        const ctaButton = playerInstance.domRef.wrapper.querySelector('.fluid_ad_cta');
        const addAdPlayingTextOverlay = playerInstance.domRef.wrapper.querySelector('.fluid_ad_playing');
        const skipBtn = playerInstance.domRef.wrapper.querySelector('.skip_button');

        if (adCountDownTimerText) { adCountDownTimerText.style.display = 'none'; }
        if (ctaButton) { ctaButton.style.display = 'none'; }
        if (addAdPlayingTextOverlay) { addAdPlayingTextOverlay.style.display = 'none'; }
        if (skipBtn) { skipBtn.style.display = 'none'; }

        // Expand the player wrapper to fill the viewport so the stereo split is
        // always centred and the canvas never breaks outside the player bounds.
        playerInstance.domRef.wrapper.classList.add('fluid_vr_active');

        // Dual control bars — one per eye, sized to 50% of the now-fullscreen wrapper.
        controlBar.classList.add("fluid_vr_controls_container");
        playerInstance.cardBoardCreateVRControls();

        if (isMobile) {
            playerInstance.cardBoardHideDefaultControls();

            // DeviceOrientationEvent.requestPermission() must be called within a
            // user gesture, which this click handler satisfies.
            playerInstance.vrViewer.getPlugin('gyroscope').start().then(() => {
                screen.orientation?.lock('landscape')?.catch(() => {});
            }).catch(() => {
                // Permission denied or no gyroscope — static split-screen only.
            });
        }

        // Disable mouse/touch drag — in VR mode the scene should only move
        // via the gyroscope, not cursor input.
        playerInstance.vrViewer.setOption('mousemove', false);

        // Apply the split-screen stereo renderer with barrel distortion.
        playerInstance.vrViewer.renderer.setCustomRenderer((renderer) => {
            const effect = new CardboardEffect(renderer);
            playerInstance._vrCardboardEffect = effect;
            return effect;
        });
    };

    playerInstance.cardBoardMoveTimeInfo = () => {
        const timePlaceholder = playerInstance.domRef.wrapper.querySelector('.fluid_control_duration');
        const controlBar = playerInstance.domRef.wrapper.querySelector('.fluid_controls_container');

        timePlaceholder.classList.add("cardboard_time");
        controlBar.appendChild(timePlaceholder);

        playerInstance.controlDurationUpdate = function () {
            const currentPlayTime = playerInstance.formatTime(playerInstance.domRef.player.currentTime);
            const totalTime = playerInstance.formatTime(playerInstance.currentVideoDuration);
            const timePlaceholder = playerInstance.domRef.player.parentNode.getElementsByClassName('fluid_control_duration');

            let durationText = '';

            if (playerInstance.isCurrentlyPlayingAd) {
                durationText = "<span class='ad_timer_prefix'>AD : </span>" + currentPlayTime + ' / ' + totalTime;

                for (let i = 0; i < timePlaceholder.length; i++) {
                    timePlaceholder[i].classList.add("ad_timer_prefix");
                }

            } else {
                durationText = currentPlayTime + ' / ' + totalTime;

                for (let i = 0; i < timePlaceholder.length; i++) {
                    timePlaceholder[i].classList.remove("ad_timer_prefix");
                }
            }

            for (let i = 0; i < timePlaceholder.length; i++) {
                timePlaceholder[i].innerHTML = durationText;
            }
        };
    };

    playerInstance.cardBoardAlterDefaultControls = () => {
        playerInstance.cardBoardMoveTimeInfo();
    };

    playerInstance.createCardboardView = () => {
        const { Viewer } = _psvModules.core;
        const { EquirectangularVideoAdapter } = _psvModules.videoAdapter;
        const { VideoPlugin } = _psvModules.videoPlugin;
        const { GyroscopePlugin } = _psvModules.gyroscopePlugin;

        const vrContainer = document.createElement('div');
        vrContainer.className = 'fluid_vr_container';
        playerInstance.domRef.player.parentNode.insertBefore(vrContainer, playerInstance.domRef.player.nextSibling);

        // PSV mounts to an inner element so its overflow:hidden doesn't clip
        // the joystick panel, which is appended directly to vrContainer
        const psvContainer = document.createElement('div');
        Object.assign(psvContainer.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' });
        vrContainer.appendChild(psvContainer);

        playerInstance.vrViewer = new Viewer({
            container: psvContainer,
            adapter: [EquirectangularVideoAdapter, { autoplay: false, muted: true }],
            panorama: { source: playerInstance.domRef.player.currentSrc },
            plugins: [
                [VideoPlugin, { progressbar: false, bigbutton: false }],
                [GyroscopePlugin, { moveMode: 'smooth' }],
            ],
            navbar: false,
            loadingTxt: '',
        });

        // Sync PSV's muted video with fluid-player's playback state.
        // PSV's video is muted; audio continues from fluid-player's video
        // element which still plays in the background.
        playerInstance.vrViewer.addEventListener('panorama-loaded', () => {
            const masterVideo = playerInstance.domRef.player;
            const videoPlugin = playerInstance.vrViewer.getPlugin(VideoPlugin);

            if (videoPlugin.video) {
                videoPlugin.video.currentTime = masterVideo.currentTime;
                if (!masterVideo.paused) {
                    videoPlugin.play();
                }
            }

            const onPlay = () => videoPlugin.play();
            const onPause = () => videoPlugin.pause();
            const onSeeked = () => {
                if (videoPlugin.video) {
                    videoPlugin.video.currentTime = masterVideo.currentTime;
                }
            };

            masterVideo.addEventListener('play', onPlay);
            masterVideo.addEventListener('pause', onPause);
            masterVideo.addEventListener('seeked', onSeeked);

            playerInstance._vrVideoCleanup = () => {
                masterVideo.removeEventListener('play', onPlay);
                masterVideo.removeEventListener('pause', onPause);
                masterVideo.removeEventListener('seeked', onSeeked);
            };
        });

        playerInstance.cardBoardAlterDefaultControls();
        playerInstance.cardBoardResize();

        if (playerInstance.displayOptions.layoutControls.showCardBoardJoystick) {
            if (!(playerInstance.getMobileOs().userOs === 'Android' || playerInstance.getMobileOs().userOs === 'iOS')) {
                playerInstance.createCardboardJoystick();
            }
            playerInstance.vrViewer.setOption('mousewheel', false);
        }

        playerInstance.trackEvent(playerInstance.domRef.player.parentNode, 'click', '.fluid_control_cardboard', function () {
            if (playerInstance.vrMode) {
                playerInstance.cardBoardSwitchToNormal();
            } else {
                playerInstance.cardBoardSwitchToVR();
            }
        });
    };

    playerInstance.createCardboard = () => {
        if (!playerInstance.displayOptions.layoutControls.showCardBoardView) {
            return;
        }

        playerInstance.domRef.wrapper.querySelector('.fluid_control_cardboard').style.display = 'inline-block';

        if (!_psvModules) {
            Promise.all([
                import(/* webpackChunkName: "psv" */ '@photo-sphere-viewer/core'),
                import('@photo-sphere-viewer/equirectangular-video-adapter'),
                import('@photo-sphere-viewer/video-plugin'),
                import('@photo-sphere-viewer/gyroscope-plugin'),
                import('three'),
            ]).then(([core, videoAdapter, videoPlugin, gyroscopePlugin, THREE]) => {
                _psvModules = { core, videoAdapter, videoPlugin, gyroscopePlugin, CardboardEffect: buildCardboardEffect(THREE) };
                playerInstance.createCardboardView();
            });
        } else {
            playerInstance.createCardboardView();
        }
    };
}
