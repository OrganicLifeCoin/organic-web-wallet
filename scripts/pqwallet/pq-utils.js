import qrcode from 'qrcode-generator';

export function createQR(data, element, size = 5) {
    const code = qrcode(size, 'L');
    code.addData(data);
    code.make();
    element.innerHTML = code.createImgTag(2, 2);
    if (element.firstChild) element.firstChild.style.borderRadius = '8px';
}

export function downloadBlob(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
