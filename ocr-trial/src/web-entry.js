// 打给正式前端用的 IIFE 入口：挂到全局，页面用普通 <script> 懒加载即可。
import { PaddleOCR } from '@paddleocr/paddleocr-js';

globalThis.PaddleOCRWeb = { PaddleOCR };
