const canvas = document.getElementById("gl-canvas");
const gl = canvas.getContext("webgl");

// 기본 설정
const RADIUS = 1.0;
const LAT_BANDS = 180;
const LON_BANDS = 360;

const HEIGHT_SCALE = 0.08;
const ROTATION_SPEED = 0.5;

gl.enable(gl.DEPTH_TEST);
gl.clearColor(0.0, 0.0, 0.0, 1.0);


// 1. Vertex Shader

const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aTexCoord;

    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform mat4 uModel;

    varying vec3 vNormal;
    varying vec2 vTexCoord;

    void main() {
        gl_Position =
            uProjection *
            uView *
            uModel *
            vec4(aPosition, 1.0);

        vNormal = mat3(uModel) * aNormal;
        vTexCoord = aTexCoord;
    }
`;


// 2. Fragment Shader

const fragmentSource = `
    precision mediump float;

    varying vec3 vNormal;
    varying vec2 vTexCoord;

    uniform sampler2D uTexture;
    uniform vec3 uLightDirection;

    void main() {
        vec3 normal = normalize(vNormal);
        vec3 light = normalize(uLightDirection);

        float diffuse = max(dot(normal, light), 0.0);
        float ambient = 0.08;

        vec4 earthColor = texture2D(uTexture, vTexCoord);

        vec3 color = earthColor.rgb *
            (ambient + diffuse * 0.92);

        gl_FragColor = vec4(color, 1.0);
    }
`;


// 3. 셰이더 생성

function createShader(type, source) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    return shader;
}

function createProgram() {
    const vertexShader = createShader(
        gl.VERTEX_SHADER, vertexSource
    );

    const fragmentShader = createShader(
        gl.FRAGMENT_SHADER, fragmentSource
    );

    const program = gl.createProgram();

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    return program;
}


// 4. 이미지 불러오기

function loadImage(src) {
    return new Promise(resolve => {
        const image = new Image();

        image.onload = () => resolve(image);
        image.src = src;
    });
}


// 5. 고도 지도 생성

function createHeightMap(image) {
    const tempCanvas = document.createElement("canvas");

    tempCanvas.width = image.width;
    tempCanvas.height = image.height;

    const ctx = tempCanvas.getContext("2d");

    ctx.drawImage(image, 0, 0);

    return ctx.getImageData(
        0, 0, image.width, image.height
    );
}


// 6. 위도와 경도를 이용한 고도 추출

function getHeight(heightMap, lat, lon) {
    const u = (lon + Math.PI) / (2 * Math.PI);
    const v = (Math.PI / 2 - lat) / Math.PI;

    const x = Math.min(
        heightMap.width - 1,
        Math.floor(u * heightMap.width)
    );

    const y = Math.min(
        heightMap.height - 1,
        Math.floor(v * heightMap.height)
    );

    const index = (y * heightMap.width + x) * 4;

    const brightness = (
        heightMap.data[index] +
        heightMap.data[index + 1] +
        heightMap.data[index + 2]
    ) / 3;

    return brightness / 255.0;
}


// 7. 지구 모델링

function createEarth(heightMap) {
    const positions = [];
    const normals = [];
    const texCoords = [];
    const indices = [];

    for (let i = 0; i <= LAT_BANDS; i++) {

        // 위도
        const lat = Math.PI / 2 -
            i * Math.PI / LAT_BANDS;

        for (let j = 0; j <= LON_BANDS; j++) {

            // 경도
            const lon = -Math.PI +
                j * 2 * Math.PI / LON_BANDS;

            const sampleLon =
                j === LON_BANDS ? -Math.PI : lon;

            const height = getHeight(
                heightMap, lat, sampleLon
            );

            // 고도에 따른 반지름
            const r = RADIUS + height * HEIGHT_SCALE;

            const x = r * Math.cos(lat) * Math.cos(lon);
            const y = r * Math.sin(lat);
            const z = r * Math.cos(lat) * Math.sin(lon);

            positions.push(x, y, z);
            normals.push(0, 0, 0);

            texCoords.push(
                j / LON_BANDS,
                i / LAT_BANDS
            );
        }
    }

    // 정점들을 삼각형으로 연결
    for (let i = 0; i < LAT_BANDS; i++) {
        for (let j = 0; j < LON_BANDS; j++) {

            const first = i * (LON_BANDS + 1) + j;
            const second = first + LON_BANDS + 1;

            indices.push(first, first + 1, second);
            indices.push(second, first + 1, second + 1);
        }
    }

    calculateNormals(positions, indices, normals);

    return {
        positions,
        normals,
        texCoords,
        indices
    };
}


// 8. 법선 벡터 계산

function calculateNormals(positions, indices, normals) {

    for (let i = 0; i < indices.length; i += 3) {

        const a = indices[i] * 3;
        const b = indices[i + 1] * 3;
        const c = indices[i + 2] * 3;

        const ux = positions[b] - positions[a];
        const uy = positions[b + 1] - positions[a + 1];
        const uz = positions[b + 2] - positions[a + 2];

        const vx = positions[c] - positions[a];
        const vy = positions[c + 1] - positions[a + 1];
        const vz = positions[c + 2] - positions[a + 2];

        // 외적
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;

        for (const index of [a, b, c]) {
            normals[index] += nx;
            normals[index + 1] += ny;
            normals[index + 2] += nz;
        }
    }

    // 경도 양 끝의 법선 연결
    for (let i = 0; i <= LAT_BANDS; i++) {

        const a = i * (LON_BANDS + 1) * 3;
        const b = a + LON_BANDS * 3;

        for (let k = 0; k < 3; k++) {
            const sum = normals[a + k] + normals[b + k];

            normals[a + k] = sum;
            normals[b + k] = sum;
        }
    }

    // 법선 벡터 정규화
    for (let i = 0; i < normals.length; i += 3) {

        const length = Math.hypot(
            normals[i],
            normals[i + 1],
            normals[i + 2]
        );

        if (length > 0.00000001) {
            normals[i] /= length;
            normals[i + 1] /= length;
            normals[i + 2] /= length;
        } else {
            const r = Math.hypot(
                positions[i],
                positions[i + 1],
                positions[i + 2]
            );

            normals[i] = positions[i] / r;
            normals[i + 1] = positions[i + 1] / r;
            normals[i + 2] = positions[i + 2] / r;
        }
    }
}


// 9. 버퍼 생성

function createAttributeBuffer(program, name, data, size) {
    const buffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(data),
        gl.STATIC_DRAW
    );

    const location = gl.getAttribLocation(program, name);

    gl.vertexAttribPointer(
        location, size, gl.FLOAT, false, 0, 0
    );

    gl.enableVertexAttribArray(location);
}

function createIndexBuffer(indices) {
    const buffer = gl.createBuffer();

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);

    gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array(indices),
        gl.STATIC_DRAW
    );
}


// 10. 텍스처 생성

function createTexture(image) {
    const texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image
    );

    gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR
    );

    gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MAG_FILTER,
        gl.LINEAR
    );

    gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_WRAP_S,
        gl.CLAMP_TO_EDGE
    );

    gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_WRAP_T,
        gl.CLAMP_TO_EDGE
    );

    return texture;
}


// 11. 원근 투영 행렬

function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);

    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, (2 * far * near) / (near - far), 0
    ]);
}


// 12. 이동 행렬

function translation(x, y, z) {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        x, y, z, 1
    ]);
}


// 13. Y축 회전 행렬

function rotationY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    return new Float32Array([
        c, 0, -s, 0,
        0, 1, 0, 0,
        s, 0, c, 0,
        0, 0, 0, 1
    ]);
}


// 14. 메인 함수

async function main() {
    console.log("JS 실행 시작");
    const program = createProgram();

    const earthImage = await loadImage("earth.jpg");
    const heightImage = await loadImage("heightmap.png");
    console.log("지구 이미지 로드 완료");

    console.log("고도 이미지 로드 완료");

    const heightMap = createHeightMap(heightImage);
    const earth = createEarth(heightMap);

    // GPU에 정점 데이터 전달
    createAttributeBuffer(
        program, "aPosition", earth.positions, 3
    );

    createAttributeBuffer(
        program, "aNormal", earth.normals, 3
    );

    createAttributeBuffer(
        program, "aTexCoord", earth.texCoords, 2
    );
    

    createIndexBuffer(earth.indices);

    const texture = createTexture(earthImage);

    // Uniform 변수
    const uProjection =
        gl.getUniformLocation(program, "uProjection");

    const uView =
        gl.getUniformLocation(program, "uView");

    const uModel =
        gl.getUniformLocation(program, "uModel");

    const uLightDirection =
        gl.getUniformLocation(program, "uLightDirection");

    const uTexture =
        gl.getUniformLocation(program, "uTexture");

    // 텍스처 연결
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uTexture, 0);

    // 카메라 위치
    gl.uniformMatrix4fv(
        uView, false, translation(0, 0, -3.8)
    );

    // 광원 방향
    gl.uniform3fv(
        uLightDirection,
        new Float32Array([-1.0, 0.4, 0.8])
    );

    // 화면 설정
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.uniformMatrix4fv(
        uProjection,
        false,
        perspective(
            Math.PI / 4,
            canvas.width / canvas.height,
            0.1,
            100.0
        )
    );


    // 15. 회전 애니메이션

    function render(time) {
        const angle = time / 1000 * ROTATION_SPEED;

        canvas.width = Math.max(1, canvas.clientWidth);
        canvas.height = Math.max(1, canvas.clientHeight);

        gl.viewport(0, 0, canvas.width, canvas.height);

        gl.uniformMatrix4fv(
            uProjection,
            false,
            perspective(
                Math.PI / 4,
                canvas.width / canvas.height,
                0.1,
                100.0
            )
        );

        gl.clear(
            gl.COLOR_BUFFER_BIT |
            gl.DEPTH_BUFFER_BIT
        );

        gl.uniformMatrix4fv(
            uModel,
            false,
            rotationY(angle)
        );

        gl.drawElements(
            gl.TRIANGLES,
            earth.indices.length,
            gl.UNSIGNED_SHORT,
            0
        );

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

main();