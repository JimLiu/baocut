/* 等距柱状投影的 360° 查看器。只做查看，不改图片。产品设计 §3.3。 */
(function () {
  const R = window.RSP;
  function MediaPanorama({ file, active, onClose }) {
    const root = React.useRef(null),
      canvas = React.useRef(null),
      camera = React.useRef({ yaw: 0, pitch: 0, fov: 90 }),
      drag = React.useRef(null),
      render = React.useRef(() => {});
    const [fov, setFov] = React.useState(90),
      [status, setStatus] = React.useState('loading');
    React.useEffect(() => {
      let closed = false,
        ready = false,
        program,
        texture,
        buffer,
        resize;
      const element = canvas.current,
        gl = element.getContext('webgl');
      if (!gl) {
        setStatus('error');
        return;
      }
      const compile = (kind, source) => {
        const shader = gl.createShader(kind);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          throw Error('shader');
        }
        return shader;
      };
      try {
        const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=p;gl_Position=vec4(p,0.,1.);}');
        const fragment = compile(
          gl.FRAGMENT_SHADER,
          'precision highp float;varying vec2 uv;uniform sampler2D img;uniform float yaw;uniform float pitch;uniform float fov;uniform float aspect;void main(){vec3 d=normalize(vec3(uv.x*aspect*tan(fov*.5),uv.y*tan(fov*.5),-1.));float c=cos(pitch),s=sin(pitch);d=vec3(d.x,d.y*c-d.z*s,d.y*s+d.z*c);c=cos(yaw);s=sin(yaw);d=vec3(d.x*c+d.z*s,d.y,-d.x*s+d.z*c);vec2 t=vec2(fract(atan(d.x,-d.z)/6.2831853+.5),.5-asin(clamp(d.y,-1.,1.))/3.1415927);gl_FragColor=texture2D(img,t);}'
        );
        program = gl.createProgram();
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('link');
        gl.useProgram(program);
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'p');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const uniforms = Object.fromEntries(['yaw', 'pitch', 'fov', 'aspect'].map((k) => [k, gl.getUniformLocation(program, k)]));
        render.current = () => {
          if (!ready) return;
          const rect = element.getBoundingClientRect(),
            ratio = Math.min(devicePixelRatio || 1, 2);
          element.width = Math.max(1, Math.round(rect.width * ratio));
          element.height = Math.max(1, Math.round(rect.height * ratio));
          gl.viewport(0, 0, element.width, element.height);
          gl.uniform1f(uniforms.yaw, camera.current.yaw);
          gl.uniform1f(uniforms.pitch, camera.current.pitch);
          gl.uniform1f(uniforms.fov, (camera.current.fov * Math.PI) / 180);
          gl.uniform1f(uniforms.aspect, element.width / element.height);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        window
          .loadMediaImage(file.previewSrc)
          .then((image) => {
            if (closed) return;
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            ready = true;
            setStatus('ready');
            render.current();
          })
          .catch(() => {
            if (!closed) setStatus('error');
          });
        resize = new ResizeObserver(() => render.current());
        resize.observe(element);
      } catch {
        setStatus('error');
      }
      const lost = (e) => {
        e.preventDefault();
        setStatus('error');
      };
      element.addEventListener('webglcontextlost', lost);
      return () => {
        closed = true;
        resize?.disconnect();
        element.removeEventListener('webglcontextlost', lost);
        render.current = () => {};
        if (texture) gl.deleteTexture(texture);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      };
    }, [file.previewSrc]);
    React.useEffect(() => {
      if (!active) drag.current = null;
    }, [active]);
    const zoom = (value) => {
      camera.current.fov = Math.max(30, Math.min(110, value));
      setFov(camera.current.fov);
      render.current();
    };
    return (
      <section ref={root} className="media-panorama" aria-label="360° 全景预览">
        <div className="media-preview__toolbar">
          <R.ActionButton onPress={() => zoom(fov - 10)}>放大</R.ActionButton>
          <R.ActionButton onPress={() => zoom(fov + 10)}>缩小</R.ActionButton>
          <span>视角 {fov}°</span>
          <R.ActionButton
            onPress={() => {
              camera.current = { yaw: 0, pitch: 0, fov: 90 };
              setFov(90);
              render.current();
            }}
          >
            重置视角
          </R.ActionButton>
          <R.ActionButton onPress={() => root.current.requestFullscreen?.().catch(() => setStatus('fullscreen-error'))}>
            全屏
          </R.ActionButton>
          <R.ActionButton onPress={onClose}>返回图片</R.ActionButton>
        </div>
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label="全景画面，拖动或使用方向键查看"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            drag.current = { x: e.clientX, y: e.clientY, yaw: camera.current.yaw, pitch: camera.current.pitch };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            camera.current.yaw = drag.current.yaw - (e.clientX - drag.current.x) * 0.005;
            camera.current.pitch = Math.max(-1.5, Math.min(1.5, drag.current.pitch + (e.clientY - drag.current.y) * 0.005));
            render.current();
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
              e.preventDefault();
              camera.current.yaw += e.key === 'ArrowLeft' ? 0.1 : e.key === 'ArrowRight' ? -0.1 : 0;
              camera.current.pitch = Math.max(
                -1.5,
                Math.min(1.5, camera.current.pitch + (e.key === 'ArrowUp' ? 0.1 : e.key === 'ArrowDown' ? -0.1 : 0))
              );
              render.current();
            }
          }}
          onWheel={(e) => zoom(fov + Math.sign(e.deltaY) * 5)}
        />
        {status !== 'ready' && (
          <p role="status">
            {status === 'loading'
              ? '正在加载全景…'
              : status === 'fullscreen-error'
                ? '无法进入全屏，可以继续在这里查看。'
                : '无法加载全景，请返回普通图片预览。'}
          </p>
        )}
      </section>
    );
  }
  window.MediaPanorama = MediaPanorama;
})();
